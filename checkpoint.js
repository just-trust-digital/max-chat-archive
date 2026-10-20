// Local, transactional recovery copies. No network or account access.
const CheckpointStore = (() => {
  let database;
  const summary = value => ({id:value.id,title:value.chat.title,messages:value.chat.messages.length,updatedAt:value.updatedAt,state:value.state});
  async function open() {
    if (database) return database;
    database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('max-archive-checkpoints', 2);
      request.onupgradeneeded = () => {
        const db=request.result;
        if(!db.objectStoreNames.contains('chats')) db.createObjectStore('chats', {keyPath:'id'});
        if(!db.objectStoreNames.contains('files')) db.createObjectStore('files', {keyPath:'id'}).createIndex('checkpointId','checkpointId');
        if(!db.objectStoreNames.contains('catalog')) {
          const catalog=db.createObjectStore('catalog',{keyPath:'id'});
          const cursor=request.transaction.objectStore('chats').openCursor();
          cursor.onsuccess=()=>{const item=cursor.result;if(item){catalog.put(summary(item.value));item.continue();}};
        }
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
      request.onblocked=()=>reject(new Error('Закройте другие страницы экспорта и повторите сохранение копии.'));
    });
    database.onversionchange=()=>{database.close();database=null;};
    return database;
  }
  async function transaction(stores, mode, action) {
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(stores,mode);
      let request;
      try {request=action(tx);} catch(error){tx.abort();reject(error);return;}
      tx.oncomplete=()=>resolve(request?.result);
      tx.onerror=()=>reject(tx.error || new Error('Не удалось сохранить копию.'));
      tx.onabort=()=>reject(tx.error || new Error('Сохранение копии прервано.'));
    });
  }
  return {
    async put(value) { const record={...value,updatedAt:new Date().toISOString()}; await transaction(['chats','catalog'],'readwrite',tx=>{tx.objectStore('chats').put(record);tx.objectStore('catalog').put(summary(record));}); },
    async get(id) {return transaction(['chats'],'readonly',tx=>tx.objectStore('chats').get(id));},
    async list() {
      const values=await transaction(['catalog'],'readonly',tx=>tx.objectStore('catalog').getAll());
      return values.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
    },
    async file(id, url, value) {
      await transaction(['files'],'readwrite',tx=>tx.objectStore('files').put({...value,id:[id,url],checkpointId:id,url}));
    },
    async files(id) {return transaction(['files'],'readonly',tx=>tx.objectStore('files').index('checkpointId').getAll(id));},
    async remove(id) {
      await transaction(['chats','files','catalog'],'readwrite',tx=>{
        tx.objectStore('chats').delete(id);tx.objectStore('catalog').delete(id);
        const request=tx.objectStore('files').index('checkpointId').openKeyCursor(IDBKeyRange.only(id));
        request.onsuccess=()=>{const cursor=request.result;if(cursor){tx.objectStore('files').delete(cursor.primaryKey);cursor.continue();}};
      });
    }
  };
})();
