// Streaming CSV reader: bounded record memory, quoted newlines and escaped quotes.
export async function* readCsv(stream) {
  const reader=stream.getReader(), decoder=new TextDecoder('utf-8',{fatal:true});
  let field='', row=[], quoted=false, afterQuote=false, skipLF=false, first=true, size=0;
  function push(){row.push(field);field='';if(row.length>100)throw Error('too_many_columns');}
  try {
    while(true){
      const {done,value}=await reader.read();
      const text=decoder.decode(value,{stream:!done});
      for(const c of text){
        if(first){first=false;if(c==='\uFEFF')continue;}
        if(skipLF){skipLF=false;if(c==='\n')continue;}
        if(++size>65536)throw Error('record_too_large');
        if(quoted){if(c==='"'){quoted=false;afterQuote=true;}else field+=c;continue;}
        if(afterQuote&&c==='"'){field+='"';quoted=true;afterQuote=false;continue;}
        if(c===','){push();afterQuote=false;continue;}
        if(c==='\n'||c==='\r'){
          push();if(row.some(x=>x!==''))yield row;row=[];afterQuote=false;size=0;skipLF=c==='\r';continue;
        }
        if(afterQuote)throw Error('invalid_quote');
        if(c==='"'){if(field)throw Error('invalid_quote');quoted=true;}else field+=c;
      }
      if(done)break;
    }
    if(quoted)throw Error('unclosed_quote');
    if(field||row.length||afterQuote){push();if(row.some(x=>x!==''))yield row;}
  } finally {reader.releaseLock();}
}
