import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, channel='chrome', args=['--disable-blink-features=AutomationControlled'])
        page = await browser.new_page(locale='en-US', user_agent=f'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{browser.version} Safari/537.36')
        page.on('pageerror', lambda e: print('JS error:', str(e)[:200], flush=True))
        page.on('response', lambda r: print('API:', r.status, r.url.split('?')[0], flush=True) if '/api/search/' in r.url else None)
        async def capture(r):
            if '/api/search/general/full/' in r.url:
                try:
                    d=await r.json()
                    print('SEARCH JSON',list(d), 'status',d.get('status_code'), 'data length',len(d.get('data',[])),flush=True)
                    if d.get('data'): print('FIRST ITEM KEYS',list(d['data'][0]),flush=True)
                except Exception as e: print('SEARCH response not JSON',str(e)[:100],flush=True)
        page.on('response',capture)
        await page.goto('https://www.tiktok.com/',wait_until='domcontentloaded',timeout=45000)
        await page.wait_for_timeout(8000)
        await page.goto('https://www.tiktok.com/search?q=VinFast',wait_until='domcontentloaded',timeout=45000)
        for i in range(12):
            await page.wait_for_timeout(5000)
            links=await page.locator('a[href*="/video/"]').count()
            print(i*5+5, 'seconds; links:', links, 'title:', await page.title(), flush=True)
            if links: break
            retry=page.get_by_role('button',name='Try again',exact=True)
            if i==3 and await retry.count():
                print('Retry normal UI after initial load',flush=True)
                await retry.click()
        print((await page.locator('body').inner_text())[:1500], flush=True)
        await browser.close()

asyncio.run(main())
