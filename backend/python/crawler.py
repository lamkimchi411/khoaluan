"""Bounded public-page collection. No login, CAPTCHA bypass or proxy rotation."""
import argparse
import asyncio
import json
import os
import sys
import urllib.request
from pathlib import Path

def ingest(brand, posts):
    payload = {'brand_id': brand, 'posts': posts}
    if os.getenv('CRAWL_JOB_ID'):
        payload['job_id'] = int(os.environ['CRAWL_JOB_ID'])
    body = json.dumps(payload).encode()
    request = urllib.request.Request(os.getenv('BACKEND_URL', 'http://127.0.0.1:3001') + '/api/ingest', data=body, headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + os.getenv('INGEST_TOKEN', '')})
    with urllib.request.urlopen(request, timeout=120) as response:
        result = json.load(response)
    evidence = Path('data/evidence')
    evidence.mkdir(parents=True, exist_ok=True)
    for post in posts:
        (evidence / (post['video_id'] + '.json')).write_text(json.dumps(post, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"Đã lưu {result['saved']} bài THẬT từ TikTok. Bình luận thu thập: {sum(len(p.get('comments', [])) for p in posts)}. Không tự tạo bình luận hoặc chỉ số bị thiếu.", flush=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--brand', type=int, required=True)
    parser.add_argument('--keyword', required=True)
    parser.add_argument('--url', action='append', default=[])
    parser.add_argument('--max-posts',type=int,default=10)
    parser.add_argument('--max-comments',type=int,default=100)
    parser.add_argument('--max-scrolls',type=int,default=12)
    args = parser.parse_args()
    try:
        from collector import collect
        if not 1<=args.max_posts<=30 or not 1<=args.max_comments<=200 or not 1<=args.max_scrolls<=30:
            raise ValueError('Giới hạn crawler không hợp lệ')
        result=asyncio.run(asyncio.wait_for(collect(args.brand,[k.strip() for k in args.keyword.split(',') if k.strip()],ingest,args.max_posts,args.max_comments,args.max_scrolls,args.url),timeout=1800))
        if result['status']=='failed': sys.exit(1)
    except asyncio.TimeoutError:
        print('Lượt quét vượt thời gian 30 phút. Dữ liệu đã nhập được giữ lại; lượt quét chưa hoàn tất.',file=sys.stderr)
        sys.exit(1)
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
