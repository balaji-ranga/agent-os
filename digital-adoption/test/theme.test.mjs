import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTheme,themeProperties} from '../web/theme.mjs';
test('theme accepts host palette and bounded layout without arbitrary CSS',()=>{
  const theme=normalizeTheme({primary:'#9933aa',background:'#101020',position:'bottom-left',radius:12,title:'Customer help'});
  assert.equal(themeProperties(theme)['--adoption-primary'],'#9933aa');
  assert.equal(theme.width,420);
  assert.equal(theme.height,680);
  assert.equal(theme.fontSize,14);
  for(const invalid of [{primary:'url(https://example.com)'},{font:'url(x)'},{width:9999},{offset:-1},{css:'body{}'},{position:'fixed'},{title:''}]) assert.throws(()=>normalizeTheme(invalid));
  assert.equal(normalizeTheme().primary,'#3459cf');
});
