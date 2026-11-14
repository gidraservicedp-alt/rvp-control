// Synthetic data for UI verification only; not part of the production entry.
export function volumeFixture(body: any) {
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const month=body.month||today.slice(0,7);
  const old=month!==today.slice(0,7);
  const registry=[
    {id:'40000000-0000-0000-0000-000000000001',code:'0013',network:'WOG',region:'UA12',region_label:'Дніпропетровська область',volume:old?10:20.5,acts:old?1:2},
    {id:'40000000-0000-0000-0000-000000000002',code:'0013',network:'UPG',region:'UA80',region_label:'Київ',volume:old?4.25:12,acts:1},
    {id:'40000000-0000-0000-0000-000000000003',code:'0027',network:'WOG',region:'UA80',region_label:'Київ',volume:old?0:8.25,acts:old?0:1},
    {id:'40000000-0000-0000-0000-000000000004',code:'0049',network:'UPG',region:'UA12',region_label:'Дніпропетровська область',volume:0,acts:0},
  ];
  const networks=[...new Set(registry.map(s=>s.network))].sort().map(value=>({value,label:value}));
  const byNetwork=registry.filter(s=>!body.network||s.network===body.network);
  const regions=[...new Map(byNetwork.map(s=>[s.region,{value:s.region,label:s.region_label}])).values()];
  const sites=byNetwork.filter(s=>!body.region||s.region===body.region).map(s=>({...s,label:`АЗК ${s.network} ${s.code}`,network_label:s.network}));
  const selected=sites.filter(s=>!body.site||s.id===body.site);
  const grouped=new Map<string,any>();
  for(const s of selected){
    const key=body.group==='region'?s.region:body.group==='site'?s.id:s.network;
    const row=grouped.get(key)||{key,title:body.group==='region'?s.region_label:body.group==='site'?s.label:s.network,volume:0,acts:0,sites:0,site_id:body.group==='site'?s.id:null,region_label:body.group==='network'?null:s.region_label};
    row.volume+=s.volume;row.acts+=s.acts;row.sites+=s.acts>0?1:0;grouped.set(key,row);
  }
  const all=[...grouped.values()].sort((a,b)=>b.volume-a.volume||a.key.localeCompare(b.key));
  const end=new Date(`${month}-01T12:00:00Z`);end.setUTCMonth(end.getUTCMonth()+1);end.setUTCDate(0);
  return {month,period_start:`${month}-01`,period_end:old?end.toISOString().slice(0,10):today,
    total:selected.reduce((n,s)=>n+s.volume,0),act_count:selected.reduce((n,s)=>n+s.acts,0),site_count:selected.filter(s=>s.acts>0).length,
    rows:body.export?all:all.slice((body.page||0)*50,(body.page||0)*50+50),row_count:all.length,more:false,networks,regions,sites};
}
