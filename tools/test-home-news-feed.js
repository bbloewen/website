// Prueft die Instagram-Regel im Startseiten-Bento (js/home-news-feed.js) mit erfundenen Daten.
// Aufruf: node tools/test-home-news-feed.js [js/home-news-feed.js]
const fs=require('fs'),vm=require('vm');
const src=fs.readFileSync(process.argv[2]||require('path').join(__dirname,'..','js','home-news-feed.js'),'utf8');
const H=3600000,D=24*H,now=Date.now();
function run(postAgeMs, articleAgeMs){
  return new Promise(res=>{
    const el=()=>({innerHTML:'',children:[],addEventListener(){},scrollWidth:0,clientWidth:0});
    const els={'news-slider-track-desktop':el(),'news-slider-track-mobile':el(),'news-slider-dots':el()};
    let ready;
    const ctx={console,Date,Promise,
      document:{addEventListener:(e,f)=>ready=f,getElementById:id=>els[id]||null,querySelector:()=>({addEventListener(){},disabled:false}),querySelectorAll:()=>[]},
      window:{addEventListener(){},setTimeout,clearTimeout},
      SiteUtils:{publishDate:a=>new Date(a.ts)},
      fetch:url=>Promise.resolve({ok:true,json:()=>Promise.resolve(
        url.includes('news.json')?{artikel:[{ts:now-articleAgeMs,datum:'x',bild:'b',titel:'Artikel',kurztext:'k',url:'/a'}]}:
        url.includes('loewenpark')?{posts:[]}:
        {posts:[{timestamp:new Date(now-postAgeMs).toISOString(),image:'i',titel:'InstaPost',caption:'c\nd',permalink:'https://instagram.com/p/x'}]})})};
    vm.runInNewContext(src,ctx); ready();
    setTimeout(()=>res(els['news-slider-track-mobile'].innerHTML.includes('InstaPost')),50);
  });
}
(async()=>{
  const cases=[['Post 10 h, Artikel 1 Tag',10*H,1*D,true],['Post 2 Tage, Artikel 6 Tage',2*D,6*D,true],['Post 2 Tage, Artikel 1 Tag',2*D,1*D,false],['Post 2 Tage, Artikel 4 Tage (nur 2 Tage Abstand)',2*D,4*D,false],['Post 2 Tage, Artikel 5 Tage (genau 3)',2*D,5*D,true]];
  let ok=0;for(const [n,p,a,exp] of cases){const got=await run(p,a);console.log((got===exp?'OK  ':'FEHL')+' '+n+' -> '+got);if(got===exp)ok++;}
  console.log(ok+'/'+cases.length);process.exit(ok===cases.length?0:1);
})();
