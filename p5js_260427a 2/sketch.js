let video;
let faceMesh;
let bodySegmentation;
let faces = [];
let segmentation;

let optionsFace = { maxFaces: 1, refine_landmarks: true, flipHorizontal: false };
let optionsBody = { maskType: "person" };

let ghostLayer;
let bwFrame;

let faceProximity = 0;

let backgroundBlurState = 0;
let videoLoaded = false;
let grainTexture;

// --- 声音组件 ---
let humOsc;
let humFilter;
let droneOsc;
let reverb;

// --- 顺序触发的水滴组件 ---
let dripOsc;
let dripEnv;
let lastDripTime = 0;
let pendingSecondDrip = false;
let secondDripTime = 0;
let dripCounter = 0;

let audioStarted = false;

// === 猎奇照片闪烁组件 ===
let creepyImages = { nose: [], man: [], woman: [], mouth: [] };
let isFlashing = false;
let flashStartTime = 0;
let lastFlashTriggerTime = 0;
let currentFlashStage = -1;
let currentFlashImages = [];
let flashLayout = [];
let confettiLayout = []; // 存储纸屑

function preload() {
  faceMesh = ml5.faceMesh(optionsFace);
  bodySegmentation = ml5.bodySegmentation("SelfieSegmentation", optionsBody);

  // 载入四类猎奇照片素材
  for (let i = 1; i <= 5; i++) creepyImages.nose.push(loadImage(`鼻${i}.png`));
  for (let i = 1; i <= 6; i++) creepyImages.man.push(loadImage(`男${i}.png`));
  for (let i = 1; i <= 4; i++) creepyImages.woman.push(loadImage(`女${i}.png`));
  for (let i = 1; i <= 6; i++) creepyImages.mouth.push(loadImage(`嘴${i}.png`));
}

function setup() {
  // 获取 canvas 实例以便于后续调整样式
  let cnv = createCanvas(640, 480);
  cnv.style('display', 'block');
  cnv.style('margin', '0 auto'); // 全屏时如果比例不一致，尽量居中

  video = createCapture(VIDEO);
  video.size(640, 480);
  video.hide();

  faceMesh.detectStart(video, (results) => { faces = results; });
  bodySegmentation.detectStart(video, (result) => { segmentation = result; });

  ghostLayer = createGraphics(640, 480);
  bwFrame = createGraphics(640, 480);

  noCursor();

  grainTexture = createGraphics(width / 2, height / 2);
  generateGrain(grainTexture, 15);

  reverb = new p5.Reverb();

  humOsc = new p5.Oscillator('sawtooth');
  humOsc.freq(32);
  humOsc.disconnect();

  humFilter = new p5.LowPass();
  humFilter.freq(80);
  humFilter.res(1);
  humOsc.connect(humFilter);
  humOsc.amp(0);

  droneOsc = new p5.Oscillator('sine');
  droneOsc.freq(32.5);
  droneOsc.amp(0);

  reverb.process(humFilter, 10, 3);
  reverb.process(droneOsc, 10, 3);

  dripOsc = new p5.Oscillator('sine');
  dripOsc.start();
  dripOsc.amp(0);
  dripEnv = new p5.Envelope();
  reverb.process(dripOsc, 12, 6);

  for (let i = 0; i < creepyImages.nose.length; i++) {
    creepyImages.nose[i].resize(0, creepyImages.nose[i].height / 3);
  }
  for (let i = 0; i < creepyImages.man.length; i++) {
    creepyImages.man[i].resize(0, creepyImages.man[i].height / 3);
  }
  for (let i = 0; i < creepyImages.woman.length; i++) {
    creepyImages.woman[i].resize(0, creepyImages.woman[i].height / 3);
  }
  for (let i = 0; i < creepyImages.mouth.length; i++) {
    creepyImages.mouth[i].resize(0, creepyImages.mouth[i].height / 3);
  }
}
// 预分配像素数组，减少内存碎片
let grainPixels = null;

function generateGrain(g, intensity) {
  g.loadPixels();
  let d = pixelDensity();
  let pixelCount = 4 * (g.width * d) * (g.height * d);

  if (!grainPixels || grainPixels.length !== pixelCount) {
    grainPixels = new Uint8ClampedArray(pixelCount);
  }

  for (let i = 0; i < pixelCount; i += 4) {
    let grain = random(-intensity, intensity);
    grainPixels[i] = 128 + grain;
    grainPixels[i + 1] = 128 + grain;
    grainPixels[i + 2] = 128 + grain;
    grainPixels[i + 3] = 255;
  }

  // 直接复制预分配的数组
  g.pixels.set(grainPixels);
  g.updatePixels();
}

function draw() {
  background(10);
  if (video.width === 0) return;

  videoLoaded = false;

  bwFrame.drawingContext.filter = 'grayscale(100%)';
  bwFrame.image(video, 0, 0, width, height);
  bwFrame.drawingContext.filter = 'none';

  push();
  translate(width, 0);
  scale(-1, 1);

  if (faces.length > 0) {
    let face = faces[0];

    if (face.keypoints[234] && face.keypoints[454]) {
      let fW = dist(face.keypoints[234].x, face.keypoints[234].y, face.keypoints[454].x, face.keypoints[454].y);
      let targetProximity = constrain(map(fW, 30, 160, 0, 1), 0, 1);
      faceProximity = lerp(faceProximity, targetProximity, 0.1);

      // --- 照片闪烁逻辑计算 ---
      if (faceProximity < 0.2) {
        // 严格使用固定的 3000 毫秒间隔
        if (!isFlashing && millis() - lastFlashTriggerTime > 3000) {
          isFlashing = true;
          flashStartTime = millis();
          currentFlashStage = -1;

          currentFlashImages = [
            random(creepyImages.nose),
            random(creepyImages.man),
            random(creepyImages.woman),
            random(creepyImages.mouth)
          ];
        }
      } else {
        isFlashing = false;
      }

      if (isFlashing) {
        let elapsed = millis() - flashStartTime;
        if (elapsed > 500) {
          isFlashing = false;
          lastFlashTriggerTime = millis();
          // 【性能优化】：清空数组内容释放内存
          flashLayout.length = 0;
          confettiLayout.length = 0;
        } else {
          // 500毫秒内闪动5次（每100毫秒更新一次位置）
          let stage = int(elapsed / 100);
          if (stage !== currentFlashStage) {
            currentFlashStage = stage;

            // 【性能优化】：复用数组空间，降低GC卡顿
            flashLayout.length = 0;
            confettiLayout.length = 0;

            let cx = face.keypoints[1].x;
            let cy = face.keypoints[1].y;

            let shuffledImgs = shuffle([...currentFlashImages]);

            for (let i = 0; i < 4; i++) {
              let img = shuffledImgs[i];
              if (img && img.width > 0) {
                let w = fW * random(0.6, 1.5);
                let h = w * (img.height / img.width);

                let offsetX = random(-fW * 0.7, fW * 0.7);
                let offsetY = random(-fW * 0.7, fW * 0.7);

                let finalX = cx + offsetX - w / 2;
                let finalY = cy + offsetY - h / 2;

                flashLayout.push({ img: img, x: finalX, y: finalY, w: w, h: h });
              }
            }

            // 【纸屑生成代码】
            let confettiCount = int(random(150, 250));
            for (let i = 0; i < confettiCount; i++) {
              let pX = cx + random(-fW * 1.5, fW * 1.5);
              let pY = cy + random(-fW * 1.5, fW * 1.5);

              let pts = [];
              let sides = int(random(3, 7));
              for (let s = 0; s < sides; s++) {
                let r = random(1.5, 6.0);
                let a = random(TWO_PI);
                pts.push({ x: pX + cos(a) * r, y: pY + sin(a) * r });
              }

              confettiLayout.push({
                vertices: pts,
                c: random(10, 80)
              });
            }
          }
        }
      } else {
        // 如果意外中断，也清空数组防止内存占用
        flashLayout.length = 0;
        confettiLayout.length = 0;
      }
      // ------------------------

      let d = dist(face.keypoints[234].x, face.keypoints[234].y, face.keypoints[454].x, face.keypoints[454].y);
      let audioProximity = map(d, 30, 160, 0, 1, true);

      let freqDetune = map(audioProximity, 0, 1, 0.5, 4.0);
      droneOsc.freq(32 + freqDetune);

      humFilter.freq(map(audioProximity, 0, 1, 80, 200));
      humFilter.res(map(audioProximity, 0, 1, 1, 15));

      humOsc.amp(map(audioProximity, 0, 1, 0.2, 0.7), 0.2);
      droneOsc.amp(map(audioProximity, 0, 1, 0.1, 0.5), 0.2);

      // playDrip();
    }

  } else {
    faceProximity = lerp(faceProximity, 1, 0.015);
    isFlashing = false;
    humOsc.amp(0, 0.5);
    droneOsc.amp(0, 0.5);
    flashLayout.length = 0;
    confettiLayout.length = 0;
  }

  backgroundBlurState = 1.0 - faceProximity;

  push();
  if (backgroundBlurState > 0.05) {
    if (!videoLoaded) {
      video.loadPixels();
      videoLoaded = true;
    }
    drawingContext.filter = `grayscale(100%) blur(${backgroundBlurState * 4}px)`;
    image(video, 0, 0, width, height);
    drawingContext.filter = 'none';
    drawRefinedDynamicMosaic(video, backgroundBlurState);
  } else {
    drawingContext.filter = `grayscale(100%)`;
    image(video, 0, 0, width, height);
  }
  pop();

  let silhoMask = null;
  if (segmentation) {
    if (segmentation.mask) silhoMask = segmentation.mask;
    else if (segmentation.length > 0 && segmentation[0].mask) silhoMask = segmentation[0].mask;
  }

  if (silhoMask) {
    let currentAlpha = map(faceProximity, 0.1, 0.4, 250, 0, true);

    if (currentAlpha > 0) {
      ghostLayer.clear();
      ghostLayer.fill(255);
      ghostLayer.noStroke();
      ghostLayer.rect(0, 0, width, height);

      // 1. 绘制照片和纸屑
      if (isFlashing && (flashLayout.length > 0 || confettiLayout.length > 0)) {
        ghostLayer.push();
        ghostLayer.drawingContext.filter = 'grayscale(100%)';
        ghostLayer.drawingContext.globalCompositeOperation = 'multiply';

        // 绘制照片
        for (let item of flashLayout) {
          ghostLayer.image(item.img, item.x, item.y, item.w, item.h);
        }

        // 绘制纸屑碎片
        ghostLayer.noStroke();
        for (let c of confettiLayout) {
          ghostLayer.fill(c.c);
          ghostLayer.beginShape();
          for (let pt of c.vertices) {
            ghostLayer.vertex(pt.x, pt.y);
          }
          ghostLayer.endShape(CLOSE);
        }

        // 【致命卡顿修复点】：显式还原上下文状态，防止底层 GPU 发生死锁和滤镜泄露
        ghostLayer.drawingContext.filter = 'none';
        ghostLayer.drawingContext.globalCompositeOperation = 'source-over';
        ghostLayer.pop();

        playDrip();
      }

      // 2. 底层裁切逻辑
      ghostLayer.drawingContext.globalCompositeOperation = 'destination-out';
      ghostLayer.image(silhoMask, 0, 0, width, height);
      ghostLayer.drawingContext.globalCompositeOperation = 'source-over';

      push();
      tint(255, currentAlpha);
      image(ghostLayer, 0, 0, width, height);
      pop();
    }
  }

  pop();

  if (frameCount % 6 == 0) {
    generateGrain(grainTexture, 15);
  }

  blendMode(OVERLAY);
  image(grainTexture, 0, 0, width, height);
  blendMode(BLEND);
}

function playDrip() {
  if (pendingSecondDrip && millis() >= secondDripTime) {
    triggerDripEffect(dripCounter % 3, true);
    pendingSecondDrip = false;
    dripCounter++;
  }

  if (!pendingSecondDrip) {
    let nextWait = random(3000, 6000);
    if (millis() - lastDripTime > nextWait) {
      triggerDripEffect(dripCounter % 3, false);
      pendingSecondDrip = true;
      secondDripTime = millis() + 250;
      lastDripTime = millis();
    }
  }
}

function drawRefinedDynamicMosaic(img, blurState) {
  noStroke();
  let particleCount = int(map(blurState, 0, 1, 100, 1000));
  let d = pixelDensity();
  let pixels = img.pixels; // 缓存 pixels 引用
  let imgWidth = img.width;

  for (let i = 0; i < particleCount; i++) {
    let size = random(2, 6);
    let x = random(width);
    let y = random(height);
    let index = (int(x * d) + int(y * d) * imgWidth) * 4;
    let r = pixels[index];
    let g = pixels[index + 1];
    let b = pixels[index + 2];
    let lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let flicker = (noise(x * 0.05, y * 0.05, frameCount * 0.1) - 0.5) * 100;
    let alpha = map(blurState, 0, 1, 20, 160);

    fill(constrain(lum + flicker, 0, 255), alpha);
    rect(x, y, size, size);
  }
}

function triggerDripEffect(mode, isSecond) {
  let baseFreq;
  if (mode === 0) {
    dripOsc.setType('sine');
    baseFreq = isSecond ? 390 : 340;
    dripEnv.setADSR(0.002, isSecond ? 0.06 : 0.08, 0.0, 0.0);
    dripEnv.setRange(0.25, 0);
  } else if (mode === 1) {
    dripOsc.setType('triangle');
    baseFreq = isSecond ? 640 : 580;
    dripEnv.setADSR(0.001, isSecond ? 0.03 : 0.05, 0.0, 0.0);
    dripEnv.setRange(0.12, 0);
  } else {
    dripOsc.setType('sine');
    baseFreq = isSecond ? 300 : 260;
    dripEnv.setADSR(0.005, isSecond ? 0.12 : 0.15, 0.0, 0.0);
    dripEnv.setRange(0.22, 0);
  }
  dripOsc.freq(baseFreq);
  dripOsc.freq(baseFreq * 1.1, 0.03);
  dripEnv.play(dripOsc);
}

function keyPressed() {
  if (key == 1) {
    triggerDripEffect(0, false);
  }
  if (key == 2) {
    triggerDripEffect(1, false);
  }
  if (key == 3) {
    triggerDripEffect(2, false);
  }
}

function mousePressed() {
  // 1. 启动音频
  if (!audioStarted) {
    userStartAudio();
    humOsc.start();
    droneOsc.start();
    audioStarted = true;
  }

  // 2. 切换全屏状态 (点击全屏)
  let fs = fullscreen();
  fullscreen(!fs);
}

function cleanupAudio() {
  if (humOsc) humOsc.stop();
  if (droneOsc) droneOsc.stop();
  if (dripOsc) dripOsc.stop();
  if (reverb) reverb.dispose();
}

// 在页面卸载时调用
window.addEventListener('beforeunload', cleanupAudio);
