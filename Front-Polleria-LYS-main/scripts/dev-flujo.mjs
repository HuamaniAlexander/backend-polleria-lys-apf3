import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cwd=fileURLToPath(new URL('../',import.meta.url));
const stripeTest = process.argv.includes('--stripe-test');
const backendArgs = stripeTest
  ? ['--env-file-if-exists=.env.stripe.local', 'scripts/local-server.mjs', '--stripe-test']
  : ['scripts/local-server.mjs'];
const backend = spawn(process.execPath, backendArgs, {
  cwd, stdio: 'inherit', windowsHide: true,
  env: stripeTest ? { ...process.env, NODE_USE_ENV_PROXY: '1' } : process.env,
});
const frontendEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(?:STRIPE_|VITE_STRIPE_|INSFORGE_API_KEY$)/.test(key),
));
let frontend;
try{
 for(let i=0;i<100;i++){
  if (backend.exitCode !== null) throw new Error('El servidor local no pudo iniciar.');
  try{const r=await fetch('http://127.0.0.1:5191/health');if((await r.json()).mode==='local')break;}catch{}
  if(i===99)throw new Error('No se pudo iniciar la base local');
  await new Promise(resolve=>setTimeout(resolve,200));
 }
 frontend=spawn(process.execPath,['node_modules/vite/bin/vite.js','--mode','flujo-local','--host','127.0.0.1','--port','5180','--strictPort'],{
  cwd,stdio:'inherit',windowsHide:true,env:{...frontendEnv,VITE_FLUJO_ATENCIONES:'true',VITE_PAGO_TARJETA_HABILITADO:stripeTest?'true':'false',VITE_INSFORGE_BASE_URL:'http://127.0.0.1:5191',VITE_INSFORGE_ANON_KEY:'local-public-anon'},
 });
 frontend.on('exit',()=>backend.kill());
 backend.on('exit',()=>frontend?.kill());
}catch(error){console.error(error.message);backend.kill();process.exitCode=1;}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{frontend?.kill();backend.kill();});
