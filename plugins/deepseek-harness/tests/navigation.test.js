import test from 'node:test';
import assert from 'node:assert/strict';
import {
  external,
  isChatRoot,
  isFileLink,
  pageKey,
  popup,
  subframe,
  topLevel,
} from '../shared/navigation.js';

test('top-level pages stay on ChatGPT and its sign-in hosts', () => {
  for (const url of [
    'https://chatgpt.com/c/abc',
    'https://chat.openai.com/',
    'https://auth.openai.com/log-in',
    'https://accounts.google.com/o/oauth2/auth?x=1',
    'https://appleid.apple.com/auth/authorize',
    'https://login.microsoftonline.com/common',
    'https://login.live.com/',
  ])
    assert.equal(topLevel(url), 'allow', url);
});

test('other web links leave for the default browser; other schemes and credentials are dropped', () => {
  assert.equal(topLevel('https://example.com/page'), 'external');
  assert.equal(topLevel('http://chatgpt.com/'), 'external');
  assert.equal(topLevel('https://chatgpt.com.evil.example/'), 'external');
  assert.equal(topLevel('https://user:pw@chatgpt.com/'), 'external');
  assert.equal(topLevel('file:///etc/passwd'), 'drop');
  assert.equal(topLevel('javascript:alert(1)'), 'drop');
  assert.equal(topLevel('x-apple.systempreferences:'), 'drop');
  assert.equal(topLevel('not a url'), 'drop');
  assert.equal(external('https://example.com/a?b'), 'https://example.com/a?b');
  assert.equal(external('mailto:a@example.com'), null);
});

test('subframes load web, about, blob and data documents only', () => {
  assert.equal(subframe('https://example.com/embed'), true);
  assert.equal(subframe('about:blank'), true);
  assert.equal(subframe('blob:https://chatgpt.com/1234'), true);
  assert.equal(subframe('data:text/html,hi'), true);
  assert.equal(subframe('http://example.com/'), false);
  assert.equal(subframe('file:///tmp/x'), false);
});

test('sign-in popups open in-session; other popups go to the browser', () => {
  assert.equal(popup('about:blank'), 'popup');
  assert.equal(popup('https://accounts.google.com/signin'), 'popup');
  assert.equal(popup('https://example.com/'), 'external');
  assert.equal(popup('about:srcdoc'), 'drop');
  assert.equal(popup('chrome://settings'), 'drop');
});

test('page keys and the chat root follow Chat.swift', () => {
  assert.equal(pageKey('https://chatgpt.com/c/abc?model=x#y'), 'https://chatgpt.com/c/abc');
  assert.equal(pageKey('https://chatgpt.com:444/c/abc'), null);
  assert.equal(pageKey('https://example.com/c/abc'), null);
  assert.equal(pageKey('http://chatgpt.com/c/abc'), null);
  assert.equal(isChatRoot('https://chatgpt.com/'), true);
  assert.equal(isChatRoot('https://chatgpt.com/g/g-abc'), true);
  assert.equal(isChatRoot('https://chatgpt.com/c/abc'), false);
});

test('file links are https on ChatGPT hosts or its file host only', () => {
  assert.equal(isFileLink('https://chatgpt.com/backend-api/estuary/content?id=1'), true);
  assert.equal(isFileLink('https://files.oaiusercontent.com/file-1?se=1'), true);
  assert.equal(isFileLink('https://oaiusercontent.com.evil.example/x'), false);
  assert.equal(isFileLink('http://files.oaiusercontent.com/x'), false);
  assert.equal(isFileLink('https://example.com/x'), false);
  assert.equal(isFileLink('file:///etc/passwd'), false);
});
