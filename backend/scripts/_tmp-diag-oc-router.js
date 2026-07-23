const html = await (await fetch('http://openconnector:3000/')).text();
const m = html.match(/src="([^"]+index[^"]+\.js)"/);
const js = await (await fetch('http://openconnector:3000' + m[1])).text();

let i = js.indexOf('path:`/overview`');
if (i < 0) i = js.indexOf('path:"/overview"');
if (i < 0) i = js.indexOf("path:'/overview'");
console.log('path overview idx', i);
console.log(js.slice(Math.max(0, i - 400), i + 1500));

for (const n of [
  'createBrowserRouter(',
  'createHashRouter(',
  'createMemoryRouter(',
  'HydratedRouter',
  'unstable_HistoryRouter',
  'basename:`',
  'basename:"',
  "basename:'",
  'BrowserRouter',
  'RouterProvider',
]) {
  console.log(n, js.indexOf(n));
}

for (const n of [
  'to:`/overview`',
  'to:"/overview"',
  'navigate(`/overview`',
  'navigate("/overview"',
  'replace:`/overview`',
  'href:`/overview`',
]) {
  let j = 0;
  let c = 0;
  while ((j = js.indexOf(n, j)) >= 0 && c < 5) {
    console.log('\nHIT', n, j);
    console.log(js.slice(j - 80, j + 120));
    j += n.length;
    c++;
  }
}

// How does the app root mount?
const mountIdx = js.lastIndexOf('createRoot');
console.log('\ncreateRoot', mountIdx, js.slice(mountIdx, mountIdx + 500));

const rootIdx = js.indexOf('getElementById(`root`)');
console.log('\nroot', rootIdx, js.slice(rootIdx - 100, rootIdx + 800));
