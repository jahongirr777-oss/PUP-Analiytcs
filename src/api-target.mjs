export function apiTarget(path,base=''){
 if(!path.startsWith('/api/'))throw Error('invalid_api_path');
 if(!base)return path;
 const url=new URL(base);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('invalid_api_origin');
 return url.origin+path;
}
