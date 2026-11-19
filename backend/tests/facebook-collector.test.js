import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFacebookPageId } from '../server/facebook-collector.js';

test('Facebook Page ID only accepts numeric public Page identifiers', () => {
  assert.equal(validateFacebookPageId('123456789012345'), true);
  assert.equal(validateFacebookPageId(''), true);
  assert.equal(validateFacebookPageId('facebook.com/example'), false);
  assert.equal(validateFacebookPageId('1234'), false);
});
