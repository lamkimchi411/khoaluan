"""Keyword-first TikTok collector. UI pagination; no CAPTCHA/login bypass."""
import asyncio
import json
import os
import re
import time
from urllib.parse import quote, urlsplit, parse_qs
from playwright.async_api import async_playwright
from tiktok_public import normalize_video, normalize_comment, fetch_video, parse_video_html, PublicDataError

class AccessRequired(RuntimeError):
    pass

def log(message):
    print(message, flush=True)

async def check_access(page):
    if await page.locator('[id*="captcha"]:visible, [class*="captcha"]:visible').count():
        raise AccessRequired('TikTok yêu cầu CAPTCHA; đã dừng, không vượt xác minh.')
    dialog = page.get_by_role('dialog').filter(has_text=re.compile(r'Log in|Đăng nhập', re.I))
    if await dialog.count() and await dialog.first.is_visible():
        raise AccessRequired('TikTok yêu cầu đăng nhập trước khi đọc dữ liệu; đã dừng.')

async def scroll_panel(page):
    # Scroll the visible comments container if present, otherwise the viewport.
    panel = page.locator('[data-e2e="comment-list"], [class*="DivCommentListContainer"], [class*="DivCommentList"]')
    for element in await panel.all():
        if await element.is_visible():
            box = await element.bounding_box()
            if box:
                await page.mouse.move(box['x'] + box['width']/2, box['y'] + box['height']/2)
                break
    await page.mouse.wheel(0, 650)

async def collect(brand, keywords, ingest, max_posts=10, max_comments=100, max_scrolls=12, urls=None):
    report = {'mode':'urls' if urls else 'keywords', 'keywords':keywords, 'discovered':0,
              'saved_posts':0,'saved_comments':0,'posts_with_comments':0,'errors':[],
              'search':[], 'comment_coverage':[], 'limits':{'posts':max_posts,'comments_per_post':max_comments,'scrolls':max_scrolls}}
    posts, discovered_urls = {}, {}
    tasks = set()
    current_id = None
    comment_maps = {}
    comment_pages = {}
    search_has_more = None
    async with async_playwright() as pw:
        channel = os.getenv('CRAWLER_BROWSER', 'chrome' if os.name=='nt' else '')
        browser = await pw.chromium.launch(headless=True, channel=channel or None,
                                           args=['--disable-blink-features=AutomationControlled'])
        context = await browser.new_context(locale='en-US', viewport={'width':1440,'height':900},
                user_agent=f'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{browser.version} Safari/537.36')
        page = await context.new_page()
        async def capture(response):
            nonlocal search_has_more
            path = urlsplit(response.url).path
            if response.status!=200 or not ('/api/search/' in path or '/api/comment/list/' in path):
                return
            try:
                data = await response.json()
            except Exception:
                return
            if '/api/search/' in path:
                if not isinstance(data.get('data'), list): return
                search_has_more = data.get('has_more')
                for item in data['data']:
                    video = item.get('item') or item.get('itemStruct')
                    if not video or len(posts)>=max_posts: continue
                    # This version collects videos, not photo slideshows.
                    if video.get('imagePost'): continue
                    try:
                        post = normalize_video(video)
                        post['collection_method']='tiktok-keyword-search'
                        posts.setdefault(post['video_id'],post)
                        discovered_urls[post['video_id']]=post['video_url']
                    except (ValueError,TypeError,AttributeError): pass
            elif current_id:
                query = parse_qs(urlsplit(response.url).query)
                response_vid = (query.get('aweme_id') or query.get('item_id') or [current_id])[0]
                if str(response_vid)!=current_id: return
                parent = (query.get('comment_id') or [None])[0] if '/reply/' in path else None
                rows = data.get('comments')
                if not isinstance(rows,list): return
                comment_pages.setdefault(current_id,[]).append({'parent':parent,'has_more':data.get('has_more'),'count':len(rows)})
                target = comment_maps.setdefault(current_id,{})
                for row in rows:
                    if len(target)>=max_comments: break
                    try:
                        comment=normalize_comment(row,current_id,parent)
                        target[comment['id']]=comment
                    except (ValueError,TypeError): pass
        def on_response(response):
            task=asyncio.create_task(capture(response)); tasks.add(task); task.add_done_callback(tasks.discard)
        page.on('response',on_response)
        async def settle():
            if tasks: await asyncio.gather(*list(tasks),return_exceptions=True)
        try:
            log('Khởi tạo phiên TikTok công khai…')
            await page.goto('https://www.tiktok.com/',wait_until='domcontentloaded',timeout=45000)
            await page.wait_for_timeout(6000)
            await check_access(page)
            if urls:
                for url in urls[:max_posts]: discovered_urls[url.split('?')[0].rstrip('/').rsplit('/',1)[-1]]=url
            else:
                for keyword in keywords:
                    if len(discovered_urls)>=max_posts: break
                    log(f'Tìm kiếm từ khóa: {keyword}')
                    search_has_more=None
                    await page.goto('https://www.tiktok.com/search?q='+quote(keyword),wait_until='domcontentloaded',timeout=45000)
                    for attempt in range(16):
                        await page.wait_for_timeout(2000)
                        await check_access(page)
                        if await page.locator('a[href*="/video/"]').count() or posts: break
                        retry=page.get_by_role('button',name=re.compile(r'^(Try again|Thử lại)$',re.I))
                        if attempt==6 and await retry.count(): await retry.first.click()
                    stale=0
                    reason='scroll_limit'
                    for _ in range(max_scrolls):
                        await check_access(page)
                        await settle()
                        before=len(discovered_urls)
                        for link in await page.locator('a[href*="/video/"]').all():
                            href=await link.get_attribute('href') or ''
                            match=re.search(r'(/@[A-Za-z0-9_.]+/video/(\d{5,30}))',href)
                            if match and len(discovered_urls)<max_posts:
                                discovered_urls.setdefault(match[2],'https://www.tiktok.com'+match[1])
                        if len(discovered_urls)>=max_posts: reason='post_limit'; break
                        if search_has_more in (0,False): reason='end_of_search_response'; break
                        stale=stale+1 if before==len(discovered_urls) else 0
                        if stale>=3: reason='no_new_results'; break
                        await page.mouse.wheel(0,900)
                        await page.wait_for_timeout(2500)
                    report['search'].append({'keyword':keyword,'stop_reason':reason,'discovered_so_far':len(discovered_urls)})
                    log(f'Tìm được {len(discovered_urls)} URL video, dừng tìm kiếm: {reason}')
            report['discovered']=len(discovered_urls)
            if not discovered_urls:
                raise RuntimeError('TikTok không trả kết quả tìm kiếm công khai cho phiên crawler. Không có bài giả thay thế.')
            for vid,url in list(discovered_urls.items())[:max_posts]:
                current_id=vid
                comment_maps[vid]={}
                stop_reason='not_loaded'
                log(f'Đọc bài và bình luận: {vid}')
                post=posts.get(vid)
                try:
                    if not post: post=await asyncio.to_thread(fetch_video,url)
                    await page.goto(url,wait_until='domcontentloaded',timeout=40000)
                    await page.wait_for_timeout(4000)
                    await check_access(page)
                    try:
                        detail=parse_video_html(await page.content(),url)
                        post.update(detail)
                        post['collection_method']='tiktok-keyword-search' if not urls else 'tiktok-public-html'
                    except PublicDataError: pass
                    # Current TikTok UI needs the Comments tab to be opened explicitly.
                    for _ in range(8):
                        tabs=page.get_by_role('button',name=re.compile(r'^(Comments|Bình luận)$',re.I))
                        if await tabs.count():
                            await tabs.first.click(); break
                        buttons=page.get_by_role('button',name=re.compile(r'Read or add comments|Đọc hoặc thêm bình luận',re.I))
                        if await buttons.count():
                            await buttons.first.click(); break
                        await page.wait_for_timeout(1500)
                    stale=0
                    for step in range(max_scrolls):
                        await page.wait_for_timeout(1800)
                        await settle()
                        await check_access(page)
                        before=len(comment_maps[vid])
                        if before>=max_comments: stop_reason='comment_limit'; break
                        replies=page.get_by_text(re.compile(r'^(View|Xem)\s+\d+\s+(repl|câu trả lời|phản hồi)',re.I))
                        opened=False
                        for button in (await replies.all())[:3]:
                            if await button.is_visible():
                                await button.click(timeout=3000); opened=True
                                await page.wait_for_timeout(800)
                        await scroll_panel(page)
                        await page.wait_for_timeout(1400)
                        await settle()
                        after=len(comment_maps[vid])
                        stale=stale+1 if after==before and not opened else 0
                        root_pages=[x for x in comment_pages.get(vid,[]) if not x['parent']]
                        if root_pages and root_pages[-1]['has_more'] in (0,False) and not opened:
                            stop_reason='end_of_public_comments'; break
                        if stale>=3:
                            stop_reason='no_more_loaded' if after else 'comments_unavailable'; break
                    else: stop_reason='scroll_limit'
                except AccessRequired as error:
                    report['errors'].append(str(error)); stop_reason='access_required'
                except Exception as error:
                    report['errors'].append(f'{vid}: {str(error)[:250]}'); stop_reason='page_error'
                await settle()
                if post:
                    post['comments']=list(comment_maps[vid].values())[:max_comments]
                    post['comment_status']=stop_reason
                    post['discovery_keyword']=','.join(x['keyword'] for x in report['search']) if not urls else None
                    await asyncio.to_thread(ingest,brand,[post])
                    report['saved_posts']+=1; report['saved_comments']+=len(post['comments'])
                    report['posts_with_comments']+=int(bool(post['comments']))
                    report['comment_coverage'].append({'video_id':vid,'collected':len(post['comments']),'reported_total':post.get('comment_count'),'stop_reason':stop_reason})
                if stop_reason=='access_required': break
                await page.wait_for_timeout(1500)
        except Exception as error:
            report['errors'].append(str(error)[:400])
        finally:
            await settle()
            await context.close(); await browser.close()
    unavailable=any(x['stop_reason'] in ('comments_unavailable','page_error','access_required','not_loaded') for x in report['comment_coverage'])
    report['status']='failed' if not report['saved_posts'] else 'partial' if report['errors'] or unavailable else 'completed'
    log('REPORT '+json.dumps(report,ensure_ascii=False))
    return report
