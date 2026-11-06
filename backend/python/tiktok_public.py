"""Read metadata published in the HTML of a public TikTok video page."""
import hashlib
import json
import re
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser

class PublicDataError(ValueError):
    pass

def canonical_url(url):
    parsed = urllib.parse.urlsplit(url.strip())
    if parsed.scheme != 'https' or parsed.hostname not in ('www.tiktok.com', 'tiktok.com') or parsed.username or parsed.password or parsed.port:
        raise PublicDataError('Chỉ nhận link https://www.tiktok.com/@tacgia/video/ID')
    if not re.fullmatch(r'/@[A-Za-z0-9_.]+/video/\d{5,30}/?', parsed.path):
        raise PublicDataError('Cần link video đầy đủ /@tacgia/video/ID; mở link rút gọn trên TikTok rồi sao chép link đầy đủ.')
    return 'https://www.tiktok.com' + parsed.path.rstrip('/')

class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        canonical_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)

class HydrationParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.active = False
        self.parts = []
    def handle_starttag(self, tag, attrs):
        if tag == 'script' and dict(attrs).get('id') == '__UNIVERSAL_DATA_FOR_REHYDRATION__':
            self.active = True
    def handle_data(self, data):
        if self.active:
            self.parts.append(data)
    def handle_endtag(self, tag):
        if tag == 'script':
            self.active = False

def normalize_video(video):
    vid = str(video.get('id', ''))
    author = video.get('author', {}).get('uniqueId', '')
    if not re.fullmatch(r'\d{5,30}', vid) or not re.fullmatch(r'[A-Za-z0-9_.]+', author):
        raise PublicDataError('TikTok không trả ID hoặc tác giả của video.')
    stats = video.get('statsV2') or video.get('stats') or {}
    def metric(key):
        value = stats.get(key)
        return int(value) if str(value).isdigit() else None
    timestamp = video.get('createTime')
    published = datetime.fromtimestamp(int(timestamp), timezone.utc).isoformat() if str(timestamp).isdigit() else None
    return {'video_id': vid, 'author': author, 'caption': video.get('desc', ''),
            'author_nickname': video.get('author', {}).get('nickname', ''),
            'hashtags': list(dict.fromkeys(re.findall(r'#(\w+)', video.get('desc','')))),
            'views': metric('playCount'), 'likes': metric('diggCount'), 'comment_count': metric('commentCount'),
            'shares': metric('shareCount'), 'saves': metric('collectCount'),
            'video_url': f'https://www.tiktok.com/@{author}/video/{vid}', 'published_at': published,
            'comments': [], 'collection_method': 'tiktok-public-html',
            'fetched_at': datetime.now(timezone.utc).isoformat()}

def normalize_comment(comment, video_id, parent_id=None):
    actual_id = str(comment.get('aweme_id') or video_id)
    if actual_id != str(video_id) or not comment.get('cid') or not isinstance(comment.get('text'), str):
        raise PublicDataError('Bình luận không khớp bài viết hoặc thiếu ID/nội dung')
    user = comment.get('user') or {}
    timestamp = comment.get('create_time')
    reply_id = comment.get('reply_id')
    parent = str(reply_id) if reply_id and str(reply_id) != '0' else parent_id
    return {'id': str(comment['cid']), 'text': comment['text'],
            'author': user.get('unique_id') or user.get('uniqueId') or '',
            'author_nickname': user.get('nickname', ''), 'parent_id': parent,
            'like_count': int(comment['digg_count']) if str(comment.get('digg_count')).isdigit() else None,
            'published_at': datetime.fromtimestamp(int(timestamp), timezone.utc).isoformat() if str(timestamp).isdigit() else None}

def parse_video_html(html, requested_url):
    parser = HydrationParser()
    parser.feed(html)
    if not parser.parts:
        raise PublicDataError('TikTok không trả metadata công khai (có thể yêu cầu xác minh hoặc video không còn khả dụng). Không tạo dữ liệu thay thế.')
    try:
        data = json.loads(''.join(parser.parts))
        video = data['__DEFAULT_SCOPE__']['webapp.video-detail']['itemInfo']['itemStruct']
        post = normalize_video(video)
    except (KeyError, TypeError, json.JSONDecodeError) as error:
        raise PublicDataError('Không có thông tin video trong phản hồi TikTok.') from error
    if post['video_id'] != canonical_url(requested_url).rsplit('/', 1)[1]:
        raise PublicDataError('ID trả về không khớp video yêu cầu.')
    post['evidence_sha256'] = hashlib.sha256(html.encode('utf-8')).hexdigest()
    return post

def fetch_video(url):
    url = canonical_url(url)
    opener = urllib.request.build_opener(SafeRedirect())
    with opener.open(urllib.request.Request(url, headers={'Accept': 'text/html'}), timeout=25) as response:
        canonical_url(response.url)
        content = response.read(6_000_001)
        if len(content) > 6_000_000:
            raise PublicDataError('Phản hồi vượt giới hạn kích thước.')
    return parse_video_html(content.decode('utf-8'), url)

if __name__ == '__main__':
    import sys
    try:
        print(json.dumps(fetch_video(sys.argv[1]), ensure_ascii=True))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
