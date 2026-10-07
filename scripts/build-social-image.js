const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { examples } = require('../public/examples');
const { renderCard } = require('./render-card');

async function main() {
  GlobalFonts.registerFromPath(path.join(__dirname, '../public/fonts/outfit-700.ttf'), 'Display');
  GlobalFonts.registerFromPath(path.join(__dirname, '../public/fonts/dm-sans-400.ttf'), 'Body');
  const canvas = createCanvas(1200,630), ctx=canvas.getContext('2d');
  ctx.fillStyle='#faf9f5';ctx.fillRect(0,0,1200,630);
  ctx.fillStyle='#4358d9';ctx.beginPath();ctx.roundRect(55,46,40,48,8);ctx.fill();
  ctx.fillStyle='#f8d55b';ctx.beginPath();ctx.moveTo(75,55);ctx.lineTo(80,67);ctx.lineTo(91,70);ctx.lineTo(80,74);ctx.lineTo(75,87);ctx.lineTo(70,74);ctx.lineTo(59,70);ctx.lineTo(70,67);ctx.closePath();ctx.fill();
  ctx.fillStyle='#242837';ctx.font='26px Display';ctx.fillText('diypokécard',110,81);
  ctx.fillStyle='#4358d9';ctx.font='15px Body';ctx.fillText('THE FREE CARD MAKER, REIMAGINED',57,175);
  ctx.font='65px Display';ctx.fillStyle='#242837';ctx.fillText('Your world.',53,260);
  ctx.fillStyle='#4358d9';ctx.fillText('Made legendary.',53,332);
  ctx.fillStyle='#f8d55b';ctx.fillRect(57,349,360,7);
  ctx.fillStyle='#6e7180';ctx.font='21px Body';ctx.fillText('People. Pets. Doodles. Wonderfully wild ideas.',57,407);
  ctx.fillStyle='#4358d9';ctx.beginPath();ctx.roundRect(57,460,233,54,12);ctx.fill();ctx.fillStyle='white';ctx.font='18px Display';ctx.fillText('Make your first card  →',79,494);
  ctx.fillStyle='#777c89';ctx.font='14px Body';ctx.fillText('Free to create  ·  No sign-up  ·  Print & play',57,551);
  for (const [index,key,x,y,rotation,width] of [[0,0,723,300,-.23,231],[1,6,986,308,.2,231],[2,2,854,275,-.04,251]]) {
    const img=await renderCard(examples[key]);
    ctx.save();ctx.translate(x,y);ctx.rotate(rotation);ctx.shadowColor='#202c4435';ctx.shadowBlur=24;ctx.shadowOffsetY=14;ctx.drawImage(img,-width/2,-width*88/63/2,width,width*88/63);ctx.restore();
  }
  fs.writeFileSync(path.join(__dirname,'../public/images/og-studio.png'),canvas.toBuffer('image/png'));
  const iconCanvas=createCanvas(180,180),iconContext=iconCanvas.getContext('2d');
  const icon=await loadImage(fs.readFileSync(path.join(__dirname,'../public/images/studio-icon.svg')));iconContext.drawImage(icon,0,0,180,180);
  fs.writeFileSync(path.join(__dirname,'../public/apple-touch-icon.png'),iconCanvas.toBuffer('image/png'));
  console.log('Created social preview (1200 × 630) and touch icon.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
