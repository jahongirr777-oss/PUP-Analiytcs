import {readCsv} from '../server/csv.mjs';
import {createMapper} from '../server/import-mapping.mjs';
import {normalizeRecord} from '../server/record.mjs';
export const labels={dispatch:'Отправка',delivery:'Доставка'};
export const errors={
 database_not_configured:'База ҳали уланмаган.',upload_rate_limit_not_configured:'Юклаш хизмати ҳали созланмаган.',
 replacement_not_configured:'Алмаштириш пароли ҳали созланмаган.',wrong_password:'Парол нотўғри.',
 data_changed_start_again:'Бошқа файл юкланди. Файлни қайта юкланг.',rate_limited:'Сўровлар кўпайди. Бироздан кейин қайта урининг.',
 publication_failed_existing_data_unchanged:'Файлда такрор ID бор ёки маълумот ўзгарди. Эски ҳисобот сақланди.',
};
export async function api(path,options={},attempt=0){
 const response=await fetch(path,{...options,cache:'no-store',signal:options.signal||AbortSignal.timeout(60000)});
 let result;try{result=await response.json();}catch{throw Error('Сервер тўғри жавоб бермади.');}
 if(response.status===429&&attempt<3){
   await new Promise(resolve=>setTimeout(resolve,60000));
   if(options.signal?.aborted)throw Error('Юклаш бекор қилинди.');
   return api(path,options,attempt+1);
 }
 if(!response.ok)throw Error(errors[result.error]||'Амал бажарилмади. Файл ва сервер ҳолатини текширинг.');
 return result;
}
export async function* mappedRows(file,kind){
 let map,line=0;
 for await(const row of readCsv(file.stream())){
   line++;
   if(!map){map=createMapper(kind,row);continue;}
   try{const record=map(row);record.codMinor??=0;normalizeRecord(record);yield record;}
   catch{throw Error(`${line}-қатор форматида хато. Файл ўзгартирилмади.`);}
 }
 if(!map)throw Error('Файл бўш.');
}
export async function upload(file,kind,mode,password,onProgress,signal){
 if(file.size>50*1024*1024)throw Error('Биринчи версияда файл ҳажми 50 MB гача.');
 let count=0;const ids=new Set();
 onProgress('Файл текширилмоқда…');
 for await(const row of mappedRows(file,kind)){
   if(signal?.aborted)throw Error('Юклаш бекор қилинди.');
   if(ids.has(row.id))throw Error('Файл ичида такрор ID бор. Аввал уларни тўғриланг.');
   ids.add(row.id);if(++count>50000)throw Error('Биринчи синов версиясида битта файл 50 000 қаторгача.');
 }
 if(!count)throw Error('Файлда маълумот йўқ.');
 const headers={'Content-Type':'application/json',...(mode==='replace'?{'X-Replace-Password':password}:{})};
 const job=await api('/api/imports',{method:'POST',headers,body:JSON.stringify({kind,mode,rows:count,confirmReplace:mode==='replace'}),signal});
 const jobHeaders={...headers,'X-Upload-Token':job.token};
 let chunk=[],seq=0,sent=0;
 const send=async()=>{
   await api(`/api/imports/${job.id}/chunk`,{method:'POST',headers:jobHeaders,body:JSON.stringify({seq,rows:chunk}),signal});
   sent+=chunk.length;seq++;chunk=[];onProgress(`${sent.toLocaleString()} / ${count.toLocaleString()} қатор юкланди`);
 };
 try{
   for await(const row of mappedRows(file,kind)){chunk.push(row);if(chunk.length===100)await send();}
   if(chunk.length)await send();onProgress('Ҳисобот янгиланмоқда…');
   return await api(`/api/imports/${job.id}/complete`,{method:'POST',headers:jobHeaders,body:'{}',signal});
 }catch(error){
   // A completed publication remains complete even if its response was lost.
   try{await api(`/api/imports/${job.id}/cancel`,{method:'POST',headers:jobHeaders,body:'{}'});}catch{}
   throw error;
 }
}
