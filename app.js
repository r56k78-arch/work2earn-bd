let token=localStorage.getItem('w2e_token');
const $=id=>document.getElementById(id);
function showTab(t){$('login').classList.toggle('hidden',t!=='login');$('register').classList.toggle('hidden',t!=='register')}
async function api(url,opt={}){opt.headers={...(opt.headers||{}),...(token?{Authorization:'Bearer '+token}:{})};if(opt.body&&typeof opt.body!=='string'){opt.headers['Content-Type']='application/json';opt.body=JSON.stringify(opt.body)}const r=await fetch(url,opt);const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Something went wrong');return d}
$('login').onsubmit=async e=>{e.preventDefault();try{const d=await api('/api/login',{method:'POST',body:{login:$('l_login').value,password:$('l_pass').value}});localStorage.setItem('w2e_token',d.token);token=d.token;load()}catch(x){$('msg').textContent=x.message}};
$('register').onsubmit=async e=>{e.preventDefault();try{const d=await api('/api/register',{method:'POST',body:{username:$('r_user').value,mobile:$('r_mobile').value,email:$('r_email').value,password:$('r_pass').value,confirmPassword:$('r_confirm').value,referralCode:$('r_ref').value}});localStorage.setItem('w2e_token',d.token);token=d.token;load()}catch(x){$('msg').textContent=x.message}};
async function load(){try{const u=await api('/api/me');$('auth').classList.add('hidden');$('dash').classList.remove('hidden');$('username').textContent=u.username;$('refcode').textContent=u.referral_code;$('balance').textContent='৳'+u.balance;$('earned').textContent='৳'+u.total_earned;$('refs').textContent=u.referrals;const ts=await api('/api/tasks');$('tasks').innerHTML=ts.length?ts.map(t=>`<div class="task"><b>${escapeHtml(t.title)}</b><p>${escapeHtml(t.description)}</p><strong>Reward: ৳${t.reward}</strong><small> Slots: ${t.approved_participants+t.pending_participants}/${t.max_participants}</small><button onclick="submitTask(${t.id})" style="float:right">Submit Proof</button></div>`).join(''):'এখন কোনো task নেই।';}catch(e){logout()}}
async function submitTask(id){
 const proof=await chooseProof();
 if(!proof)return;
 try{await api('/api/tasks/'+id+'/submit',{method:'POST',body:{proof}});alert('Screenshot/Proof submitted.');load()}catch(e){alert(e.message)}
}
function chooseProof(){return new Promise(resolve=>{
 const old=document.getElementById('proofFilePicker');if(old)old.remove();
 const input=document.createElement('input');input.type='file';input.id='proofFilePicker';input.accept='image/*';input.style.display='none';document.body.appendChild(input);
 input.onchange=()=>{const f=input.files&&input.files[0];if(!f){input.remove();resolve(null);return}if(f.size>10*1024*1024){alert('Screenshot 10MB-এর মধ্যে দিন।');input.remove();resolve(null);return}const r=new FileReader();r.onload=()=>{const data=String(r.result||'');input.remove();resolve(data)};r.onerror=()=>{input.remove();resolve(null)};r.readAsDataURL(f)};
 input.click();
})}
$('withdraw').onsubmit=async e=>{e.preventDefault();try{await api('/api/withdraw',{method:'POST',body:{method:$('method').value,account:$('account').value,amount:Number($('amount').value)}});alert('Withdrawal request submitted.');load()}catch(x){alert(x.message)}};
function logout(){localStorage.removeItem('w2e_token');location.reload()}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
if($('theme'))$('theme').onclick=()=>{document.body.classList.toggle('light');$('theme').textContent=document.body.classList.contains('light')?'🌙 Dark':'☀️ Light'};
if(token)load();
