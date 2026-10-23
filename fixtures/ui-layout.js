const params = new URLSearchParams(location.search);
const width = [340,390,768,1280].includes(Number(params.get('width'))) ? Number(params.get('width')) : 1280;
const theme = params.get('theme') === 'light' ? 'light' : 'dark';
const routes = {settings:'/test/export-visibility.html',popup:'/test/popup-preview.html',report:'/report.html',known:'/known-issues.html'};
const surface = Object.hasOwn(routes, params.get('surface')) ? params.get('surface') : 'settings';
const frame = document.createElement('iframe');
frame.title = surface; frame.width = width; frame.height = surface === 'settings' ? (width < 700 ? 5000 : 2600) : (width < 700 ? 2400 : 1800); frame.style.border = '0';
const query = new URLSearchParams({tab:'7',fixture:params.get('fixture') || 'recovery',theme,chats:params.get('chats') || '',update:params.get('update') || 'current',utm_source:'jtd_dev'});
frame.src = routes[surface] + '?' + query;
document.getElementById('frames').append(frame);
frame.addEventListener('load',async()=>{
 const d=frame.contentDocument; await d.fonts.ready;
 const rect = selector => {const el=d.querySelector(selector);return el ? el.getBoundingClientRect().toJSON() : null;};
 frame.dataset.updateLayout=JSON.stringify({width:d.documentElement.clientWidth,scrollWidth:d.documentElement.scrollWidth,font:d.defaultView.getComputedStyle(d.body).fontFamily,interLoaded:d.fonts.check('14px Inter'),footer:rect('.product-footer'),contact:rect('.footer-contact'),maker:rect('.maker'),github:rect('.github-link'),actions:rect('.report-actions'),panel:rect('.update-panel'),updateOpen:d.querySelector('.update-panel')?.open});
});
