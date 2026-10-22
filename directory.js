class DirectoryArchive {
  constructor(save,name) {DirectoryArchive.parts(name);if(name.includes('/'))throw new Error('Некорректное имя папки.');this.save=save;this.name=name;this.pending=Promise.resolve();this.error=null;}
  static parts(name) {
    const parts=String(name).split('/');
    if(parts.some(part=>!part || part==='.' || part==='..' || /[<>:"\\|?*\x00-\x1f]/.test(part))) throw new Error('Недопустимый путь файла экспорта.');
    return parts;
  }
  add(name,data) {
    DirectoryArchive.parts(name);
    const job=this.pending.then(async()=>{
      if(this.error) throw this.error;
      try {
        const type=name.endsWith('.html')?'text/html;charset=utf-8':name.endsWith('.json')?'application/json':'application/octet-stream';
        await this.save(new Blob([data],{type}),`${this.name}/${name}`);
      } catch(error) {
        const failure=new Error(`Не удалось сохранить ${name}: ${error.message}`);failure.code='DIRECTORY_WRITE';throw failure;
      }
    });
    // Formatters can enqueue text synchronously; flush still surfaces every failure.
    this.pending=job.catch(error=>{this.error=error;});
    return job;
  }
  async flush() {await this.pending;if(this.error) throw this.error;}
}
