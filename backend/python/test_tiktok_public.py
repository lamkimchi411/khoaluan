import json
import unittest
from tiktok_public import canonical_url, parse_video_html, normalize_comment, PublicDataError

URL = 'https://www.tiktok.com/@test/video/123456789'

class PublicMetadataTests(unittest.TestCase):
    def test_comment_preserves_reply_identity_and_timestamp(self):
        raw={'cid':'c2','aweme_id':'123456789','text':'Không hài lòng','digg_count':5,'create_time':1700000000,'reply_id':'c1','user':{'unique_id':'reader','nickname':'Reader'}}
        c=normalize_comment(raw,'123456789')
        self.assertEqual(c['parent_id'],'c1')
        self.assertEqual(c['like_count'],5)
        self.assertEqual(c['author'],'reader')
        self.assertTrue(c['published_at'].startswith('2023-11'))
        with self.assertRaises(PublicDataError): normalize_comment(raw,'999999999')
    def fixture(self, stats=None, vid='123456789'):
        item={'id':vid,'desc':'VinFast public caption','author':{'uniqueId':'test'},'createTime':'1700000000'}
        if stats is not None:
            item['stats']=stats
        return '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">'+json.dumps({'__DEFAULT_SCOPE__':{'webapp.video-detail':{'itemInfo':{'itemStruct':item}}}})+'</script>'

    def test_real_metadata_and_zero(self):
        p=parse_video_html(self.fixture({'playCount':120,'diggCount':0}),URL)
        self.assertEqual(p['views'],120)
        self.assertEqual(p['likes'],0)
        self.assertIsNone(p['comment_count'])
        self.assertEqual(p['comments'],[])
        self.assertEqual(len(p['evidence_sha256']),64)

    def test_missing_metrics_are_not_fake_zero(self):
        p=parse_video_html(self.fixture(),URL)
        self.assertIsNone(p['views'])
        self.assertIsNone(p['likes'])

    def test_blocks_wrong_identity_and_no_data(self):
        with self.assertRaises(PublicDataError): parse_video_html(self.fixture(vid='999999999'),URL)
        with self.assertRaises(PublicDataError): parse_video_html('<html>Verify</html>',URL)

    def test_rejects_non_tiktok_and_redirect_targets(self):
        for u in ['http://127.0.0.1/video/123456789','https://www.tiktok.com.evil.test/@test/video/123456789','https://www.tiktok.com:443/@test/video/123456789','https://user@www.tiktok.com/@test/video/123456789']:
            with self.assertRaises(PublicDataError): canonical_url(u)
        self.assertEqual(canonical_url(URL+'?share=1'),URL)

if __name__ == '__main__': unittest.main()
