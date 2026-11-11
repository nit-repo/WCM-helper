/* bookmarklet.js — builds the "Send to WCM Helper" bookmarklet on its install page.
 *
 * A file of its own rather than an inline script: the site's
 * Content-Security-Policy runs scripts from this origin only.
 */
(function () {
  // The tool origin is baked in from this page's own, so the same
  // install page works unmodified whether WCM Helper is on localhost
  // during dev or wherever it is deployed — nothing to keep in sync.
  // Two delivery channels, both attempted, neither of which opens or
  // navigates anything. There is deliberately no "no channel worked"
  // fallback that opens a tab: the capture goes to the tab you are
  // already working in or it does not go, and the overlay says which.
  //
  //   1. window.opener.postMessage — the only channel that can cross
  //      origins, which is why the page has to be opened from
  //      QA's launcher for this to have anywhere to go.
  //   2. BroadcastChannel — origin-scoped, so it only ever reaches
  //      tabs on the page's own origin. Included because it costs
  //      nothing and covers the same-origin case.
  //
  // Targeted at the exact tool origin, never '*': this payload is the
  // page's entire markup, including internal preview URLs and copy
  // that has not shipped.
  var origin = location.origin;

  var src = 'javascript:' + encodeURI('(function(){' +
    'try{' +
      'var h=document.documentElement.outerHTML;' +
      'var p={type:"WCM_PAGE_CAPTURE",html:h,url:location.href,title:document.title};' +
      'var sent=false;' +
      'if(window.opener&&!window.opener.closed){try{window.opener.postMessage(p,"' + origin + '");sent=true;}catch(e){}}' +
      'try{var bc=new BroadcastChannel("wcm_helper");bc.postMessage(p);bc.close();}catch(e){}' +
      'var kb=Math.round(h.length/1024);' +
      'var u=location.href.length>68?location.href.slice(0,68)+"\u2026":location.href;' +
      'var esc=function(t){return String(t).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");};' +
      'var accent=sent?"#1450F5":"#A1681D";' +
      'var inner=\'<div style="background:#FFFFFF;border:1px solid #E6E6E6;border-top:4px solid \'+accent+\';border-radius:8px;padding:24px 28px;max-width:420px;width:88%;box-sizing:border-box;text-align:left;font-family:Inter,system-ui,-apple-system,Arial,sans-serif;color:#141414">\'' +
        '+\'<div style="font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:\'+accent+\';margin-bottom:10px">\'+(sent?"Sent to WCM Helper":"Nowhere to send it")+\'</div>\'' +
        '+\'<div style="font-size:16px;font-weight:600;margin-bottom:6px;word-break:break-word">\'+esc(document.title||"This page")+\'</div>\'' +
        '+\'<div style="font-size:12px;color:#727272;margin-bottom:14px;word-break:break-all">\'+esc(u)+\'</div>\'' +
        '+(sent' +
          '?\'<div style="font-size:13px;color:#141414">\'+kb+\' KB of markup is now in the QA tab, with your brief still there.</div>\'' +
          ':\'<div style="font-size:13px;color:#141414;line-height:1.55">This page was not opened from WCM Helper, so there is no tab to send it to.<br><br>In WCM Helper, go to <b>QA</b>, paste this URL into <b>Page</b>, click <b>Open page</b>, then click the bookmarklet on the tab that opens.</div>\')' +
        '+\'</div>\';' +
      'var prev=document.getElementById("__wcmh__");if(prev)prev.remove();' +
      'var shown=false;' +
      'try{' +
        'var d=document.createElement("dialog");d.id="__wcmh__";' +
        'd.style.background="rgba(20,20,20,.55)";d.style.border="none";d.style.padding="0";d.style.margin="0";' +
        'd.style.width="100vw";d.style.height="100vh";d.style.maxWidth="100vw";d.style.maxHeight="100vh";' +
        'd.style.display="flex";d.style.alignItems="center";d.style.justifyContent="center";' +
        'd.innerHTML=inner;document.body.appendChild(d);d.showModal();shown=true;' +
        'setTimeout(function(){try{d.close();}catch(e){}d.remove();},sent?3200:9000);' +
      '}catch(e){}' +
      'if(!shown){' +
        'var o=document.createElement("div");o.id="__wcmh__";' +
        'o.style.position="fixed";o.style.top="0";o.style.left="0";o.style.right="0";o.style.bottom="0";' +
        'o.style.background="rgba(20,20,20,.55)";o.style.zIndex="2147483647";' +
        'o.style.display="flex";o.style.alignItems="center";o.style.justifyContent="center";' +
        'o.innerHTML=inner;(document.body||document.documentElement).appendChild(o);' +
        'setTimeout(function(){o.remove();},sent?3200:9000);' +
      '}' +
    '}catch(e){alert("Could not capture this page: "+e.message);}' +
  '})();');

  var link = document.getElementById('bookmarklet-link');
  link.setAttribute('href', src);
  // The link is for dragging to the bookmarks bar; clicking it here does nothing.
  link.addEventListener('click', function (e) { e.preventDefault(); });
})();
