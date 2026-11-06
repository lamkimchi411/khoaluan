"""Send configured alerts. Secrets come from environment, payload from stdin."""
import json
import os
import smtplib
import ssl
import sys
import urllib.request
from email.message import EmailMessage

def deliver(payload):
    results = []
    if payload.get('email'):
        if not os.getenv('SMTP_HOST'):
            results.append('Email: chưa cấu hình SMTP_HOST')
        else:
            try:
                msg = EmailMessage()
                msg['Subject'] = 'BrandPulse — Cảnh báo thương hiệu'
                msg['From'] = os.environ['SMTP_FROM']
                msg['To'] = payload['email']
                msg.set_content(payload['message'])
                with smtplib.SMTP(os.environ['SMTP_HOST'], int(os.getenv('SMTP_PORT', '587')), timeout=20) as smtp:
                    smtp.starttls(context=ssl.create_default_context())
                    if os.getenv('SMTP_USER'):
                        smtp.login(os.environ['SMTP_USER'], os.environ['SMTP_PASSWORD'])
                    smtp.send_message(msg)
                results.append('Email: đã gửi')
            except Exception:
                results.append('Email: gửi thất bại, kiểm tra SMTP và địa chỉ nhận')
    if payload.get('telegram'):
        token = os.getenv('TELEGRAM_BOT_TOKEN')
        if not token:
            results.append('Telegram: chưa cấu hình TELEGRAM_BOT_TOKEN')
        else:
            try:
                request = urllib.request.Request(f'https://api.telegram.org/bot{token}/sendMessage', data=json.dumps({'chat_id': payload['telegram'], 'text': payload['message']}).encode(), headers={'Content-Type': 'application/json'})
                with urllib.request.urlopen(request, timeout=20) as response:
                    if not json.load(response).get('ok'):
                        raise ValueError('Delivery rejected')
                results.append('Telegram: đã gửi')
            except Exception:
                results.append('Telegram: gửi thất bại, kiểm tra bot token và chat ID')
    return '; '.join(results) or 'Chỉ thông báo trong ứng dụng'

if __name__ == '__main__':
    print(deliver(json.load(sys.stdin)), flush=True)
