(() => {
  const months=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const iso=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  function parse(value) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
    const [year,month,day]=value.split('-').map(Number),date=new Date(year,month-1,day);
    return year>=1900 && year<=2100 && iso(date)===value?date:null;
  }
  function monthGrid(year,month) {
    const first=new Date(year,month,1),offset=(first.getDay()+6)%7;
    return Array.from({length:42},(_,index)=>new Date(year,month,index-offset+1));
  }
  const $=id=>document.getElementById(id),dialog=$('date-dialog');
  function refresh() {
    for(const key of ['from','to']) if($('date-'+key+'-value')) {
      const date=parse($(key).value);
      $('date-'+key+'-value').textContent=date?date.toLocaleDateString('ru-RU'):'дд.мм.гггг';
    }
  }
  globalThis.ArchiveCalendar={refresh,monthGrid,iso,parse};
  if(!dialog) return;
  let field,opener,focusDate=new Date(),year=focusDate.getFullYear(),month=focusDate.getMonth();
  const fullDate=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',weekday:'long'});
  months.forEach((name,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=name;$('date-month').append(option);});
  function render(focus=false) {
    const selected=$(field)?.value,today=iso(new Date()),grid=$('calendar-days');
    $('date-month').value=String(month);$('date-year').value=String(year);
    $('calendar-month-name').textContent=`${months[month]} ${year}`;
    $('date-prev').disabled=year===1900 && month===0;$('date-next').disabled=year===2100 && month===11;
    grid.replaceChildren();
    const dates=monthGrid(year,month);
    for(let row=0;row<6;row++) {
      const line=document.createElement('div');line.className='calendar-row';line.setAttribute('role','row');
      for(const date of dates.slice(row*7,row*7+7)) {
        const button=document.createElement('button'),value=iso(date);button.type='button';button.className='calendar-day'+(date.getMonth()===month?'':' outside');button.textContent=String(date.getDate());button.dataset.date=value;button.setAttribute('role','gridcell');button.setAttribute('aria-label',fullDate.format(date));button.setAttribute('aria-selected',String(value===selected));button.tabIndex=value===iso(focusDate)?0:-1;
        if(value===today) button.setAttribute('aria-current','date');
        button.disabled=date.getFullYear()<1900 || date.getFullYear()>2100;
        button.addEventListener('click',()=>choose(value));line.append(button);
      }
      grid.append(line);
    }
    if(focus) grid.querySelector('[tabindex="0"]')?.focus();
  }
  function choose(value) {$(field).value=value;$(field).dispatchEvent(new Event('change',{bubbles:true}));refresh();dialog.close();}
  function open(key) {
    field=key;opener=$('date-'+key);focusDate=parse($(key).value)||new Date();year=focusDate.getFullYear();month=focusDate.getMonth();
    $('date-heading').textContent=key==='from'?'Начальная дата':'Конечная дата';render();dialog.showModal();$('calendar-days').querySelector('[tabindex="0"]')?.focus();
  }
  function moveMonth(delta) {
    const date=new Date(year,month+delta,1);
    if(date.getFullYear()<1900 || date.getFullYear()>2100) return;
    year=date.getFullYear();month=date.getMonth();focusDate=new Date(year,month,1);render();
  }
  for(const key of ['from','to']) $('date-'+key).addEventListener('click',()=>open(key));
  $('date-prev').addEventListener('click',()=>moveMonth(-1));$('date-next').addEventListener('click',()=>moveMonth(1));
  $('date-month').addEventListener('change',()=>{month=Number($('date-month').value);focusDate=new Date(year,month,1);render();});
  function changeYear() {const value=Number($('date-year').value);if(!Number.isInteger(value) || value<1900 || value>2100) return;year=value;focusDate=new Date(year,month,1);render();}
  $('date-year').addEventListener('input',changeYear);$('date-year').addEventListener('change',changeYear);
  $('date-close').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>opener?.focus());
  $('date-clear').addEventListener('click',()=>choose(''));$('date-today').addEventListener('click',()=>choose(iso(new Date())));
  $('calendar-days').addEventListener('keydown',event=>{
    const date=parse(event.target.dataset.date);if(!date) return;
    const day=(date.getDay()+6)%7;
    const offsets={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7,Home:-day,End:6-day};
    if(Object.hasOwn(offsets,event.key)) date.setDate(date.getDate()+offsets[event.key]);
    else if(event.key==='PageUp' || event.key==='PageDown') {const oldDay=date.getDate();date.setDate(1);date.setMonth(date.getMonth()+(event.key==='PageUp'?-1:1));date.setDate(Math.min(oldDay,new Date(date.getFullYear(),date.getMonth()+1,0).getDate()));}
    else return;
    event.preventDefault();if(date.getFullYear()<1900 || date.getFullYear()>2100) return;
    focusDate=date;year=date.getFullYear();month=date.getMonth();render(true);
  });
  refresh();
})();
