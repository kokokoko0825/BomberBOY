import { useEffect, useRef, useState } from "react";
// import "./App.css";

type Vector2D = {
  x: number;
  y: number;
};

type Particle = {
  position: Vector2D;
  velocity: Vector2D;
  angularVelocity: number;
  rotation: number;
  life: number;
  opacity: number;
  size: number;
  color: string;
  vertices: Vector2D[]; // 中心原点での多角形頂点
};

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const randomRange = (min: number, max: number): number => {
  return Math.random() * (max - min) + min;
};

const createIrregularPolygon = (radius: number): Vector2D[] => {
  // 3〜5角形をランダムに選択
  const vertexCount = Math.floor(randomRange(3, 6));
  const vertices: Vector2D[] = [];
  const baseRotation = Math.random() * Math.PI * 2;
  const segment = (Math.PI * 2) / vertexCount;

  // 各頂点の角度を等間隔ベース + 強めのジッターで生成し、
  // 半径もランダム化して正多角形にならないようにする
  for (let i = 0; i < vertexCount; i += 1) {
    const angleJitter = randomRange(-segment * 0.48, segment * 0.48);
    const angle = baseRotation + i * segment + angleJitter;
    const r = radius * randomRange(0.5, 1.15);
    vertices.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
  }

  // さらに1頂点だけ半径を強めに偏らせ、不規則性を保証
  const idx = Math.floor(Math.random() * vertexCount);
  const sign = Math.random() < 0.5 ? -1 : 1;
  const bias = 1 + sign * randomRange(0.15, 0.5);
  vertices[idx] = {
    x: vertices[idx].x * bias,
    y: vertices[idx].y * bias,
  };

  return vertices;
};

function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const [isRunning, setIsRunning] = useState<boolean>(true);
  const [hasExploded, setHasExploded] = useState<boolean>(false);
  const [hasEverExploded, setHasEverExploded] = useState<boolean>(false);
  const wordRef = useRef<HTMLDivElement | null>(null);
  const explodeRef = useRef<(() => void) | null>(null);
  const clearFragmentsRef = useRef<(() => void) | null>(null);
  const reappearTimeoutRef = useRef<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [thresholdDb, setThresholdDb] = useState<number>(-40); // しきい値（dB）
  const [requiredMs, setRequiredMs] = useState<number>(1000); // 継続必要時間（ms）
  // mic
  const micRafRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const dataArrayRef = useRef<Float32Array | null>(null);
  const [dbLevel, setDbLevel] = useState<number | null>(null);
  const aboveStartRef = useRef<number | null>(null);

  // ページタイトルとメタデータを設定
  useEffect(() => {
    document.title = "BomberBOY - 暑さを吹き飛ばせ！";
    
    // メタタグの更新
    const updateMetaTag = (name: string, content: string) => {
      let meta = document.querySelector(`meta[name="${name}"]`);
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('name', name);
        document.head.appendChild(meta);
      }
      meta.setAttribute('content', content);
    };

    const updateOGTag = (property: string, content: string) => {
      let meta = document.querySelector(`meta[property="${property}"]`);
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('property', property);
        document.head.appendChild(meta);
      }
      meta.setAttribute('content', content);
    };

    // 基本メタデータ
    updateMetaTag('description', '暑さを吹き飛ばせ！クリックで『暑い』が爆散するインタラクティブなアプリケーション');
    updateMetaTag('keywords', '暑さ,爆散,パーティクル,インタラクティブ,アプリ');
    updateMetaTag('author', 'BomberBOY');
    updateMetaTag('theme-color', '#22060a');

    // OGPメタデータ
    updateOGTag('og:title', 'BomberBOY - 暑さを吹き飛ばせ！');
    updateOGTag('og:description', '暑さを吹き飛ばせ！クリックで『暑い』が爆散するインタラクティブなアプリケーション');
    updateOGTag('og:type', 'website');
    updateOGTag('og:site_name', 'BomberBOY');

    // Twitter Card
    updateMetaTag('twitter:card', 'summary_large_image');
    updateMetaTag('twitter:title', 'BomberBOY - 暑さを吹き飛ばせ！');
    updateMetaTag('twitter:description', '暑さを吹き飛ばせ！クリックで『暑い』が爆散するインタラクティブなアプリケーション');
  }, []);

  // DPI 対応でキャンバスをリサイズ
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const parent = canvas.parentElement;
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const width = parent ? parent.clientWidth : window.innerWidth;
      const height = parent ? parent.clientHeight : window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    };

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let particles: Particle[] = [];
    let lastTimestamp = performance.now();

    const gravity = 900; // px/s^2
    const linearDamping = 0.98; // 毎フレームの速度減衰
    const angularDamping = 0.985;
    const floorBounce = 0.55; // 下端バウンス係数
    const wallBounce = 0.65; // 左右端バウンス係数
    const fadePerSecond = 0; // 不透明度の減衰/秒（0で永続）

    /**
     * 中央の文字をラスタライズし、画素サンプルごとの破片を生成
     */
    const shatterWord = (center: Vector2D) => {
      // 表示している文字と同等のスタイルでオフスクリーンに描画
      const fontSize = 96; // DOM の表示と合わせる
      const fontWeight = 900;
      const fontFamily = "ui-sans-serif, system-ui, -apple-system";
      const font = `${fontWeight} ${fontSize}px ${fontFamily}`;

      const off = document.createElement("canvas");
      const offCtx = off.getContext("2d");
      if (!offCtx) return;
      offCtx.font = font;
      offCtx.textAlign = "center";
      offCtx.textBaseline = "middle";
      const padding = 32;
      const metrics = offCtx.measureText("暑い");
      const textWidth = Math.ceil(metrics.width);
      const textHeight = Math.ceil(fontSize * 1.2);
      off.width = textWidth + padding * 2;
      off.height = textHeight + padding * 2;

      // DOM 上の色を採用
      const domColor = wordRef.current
        ? getComputedStyle(wordRef.current).color || "#ffffff"
        : "#ffffff";
      // 背景透明、文字を DOM の色で塗る
      offCtx.clearRect(0, 0, off.width, off.height);
      offCtx.fillStyle = domColor;
      offCtx.font = font;
      offCtx.textAlign = "center";
      offCtx.textBaseline = "middle";
      offCtx.fillText("暑い", off.width / 2, off.height / 2);

      const image = offCtx.getImageData(0, 0, off.width, off.height);
      const data = image.data;
      const fragments: Particle[] = [];
      const step = 4; // 密度を上げる（小さいほど精細・破片数が増える）
      const maxLen = Math.hypot(off.width / 2, off.height / 2) || 1;
      // 中央（"暑・さ" の中点）から発生させる

      for (let y = 0; y < off.height; y += step) {
        for (let x = 0; x < off.width; x += step) {
          const idx = (y * off.width + x) * 4;
          const alpha = data[idx + 3];
          if (alpha > 30) {
            const r = data[idx + 0];
            const g = data[idx + 1];
            const b = data[idx + 2];
            const a = alpha / 255;
            const color = `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;

            // その画素が文字内で占める元の座標（メインキャンバス座標）
            const origX = center.x + (x - off.width / 2);
            const origY = center.y + (y - off.height / 2);

            // 方向は「中心 → 元の画素位置」
            const dirX = origX - center.x;
            const dirY = origY - center.y;
            const len = Math.hypot(dirX, dirY) || 1;
            const nx = dirX / len;
            const ny = dirY / len;

            // 生成位置は完全に中心（ジッターなし）
            const worldX = center.x;
            const worldY = center.y;

            // 速度は基礎値 + 中心ほど強いブースト（近いほどブースト高）
            const baseSpeed = randomRange(450, 1200);
            const outwardBoost = (1 - Math.min(len / maxLen, 1)) * randomRange(600, 1200);
            const speed = baseSpeed + outwardBoost;
            const jitter = randomRange(-0.6, 0.6);
            const vx = nx * speed + jitter * speed * 0.25;
            const vy = ny * speed + jitter * speed * 0.25;

            const s = step * randomRange(2.4, 4.4); // 破片を大きめに
            fragments.push({
              position: { x: worldX, y: worldY },
              velocity: { x: vx, y: vy },
              angularVelocity: randomRange(-8, 8),
              rotation: randomRange(0, Math.PI * 2),
              life: 1,
              opacity: 1,
              size: s,
              color,
              vertices: createIrregularPolygon(s * 0.9),
            });
          }
        }
      }
      particles = particles.concat(fragments);
    };

    // クリックは HTML の「暑い」要素でのみ受け取り、そこで爆散させる
    const explodeFromWord = () => {
      if (!wordRef.current) return;
      const wordRect = wordRef.current.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      const x = wordRect.left - canvasRect.left + wordRect.width / 2;
      const y = wordRect.top - canvasRect.top + wordRect.height / 2;
      shatterWord({ x, y });
      setHasExploded(true);
      setHasEverExploded(true);
      // 爆発直後のフレームでの時間差による外縁開始を防ぐ
      lastTimestamp = performance.now();
      // 5秒後に文字を再表示
      if (reappearTimeoutRef.current) {
        window.clearTimeout(reappearTimeoutRef.current);
      }
      reappearTimeoutRef.current = window.setTimeout(() => {
        setHasExploded(false);
      }, 1000);
    };
    explodeRef.current = explodeFromWord;
    clearFragmentsRef.current = () => {
      particles = [];
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };

    // ハンドラを ref に保管して、クリーンアップ時に外す
    (wordRef as any)._explodeHandler = explodeFromWord as () => void;
    const attach = () => {
      if (wordRef.current) {
        wordRef.current.addEventListener("click", (wordRef as any)._explodeHandler);
      }
    };
    const detach = () => {
      if (wordRef.current && (wordRef as any)._explodeHandler) {
        wordRef.current.removeEventListener("click", (wordRef as any)._explodeHandler);
      }
    };
    // 初回 attach
    attach();

    const step = (timestamp: number) => {
      if (!isRunning) return;
      const dt = clamp((timestamp - lastTimestamp) / 1000, 0, 0.033); // 秒
      lastTimestamp = timestamp;

      // 物理更新
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;

      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i];
        // 重力
        p.velocity.y += gravity * dt;
        // 位置更新
        p.position.x += p.velocity.x * dt;
        p.position.y += p.velocity.y * dt;
        // 回転更新
        p.rotation += p.angularVelocity * dt;
        // 減衰
        p.velocity.x *= linearDamping;
        p.velocity.y *= linearDamping;
        p.angularVelocity *= angularDamping;
        // 壁衝突
        if (p.position.x < 0) {
          p.position.x = 0;
          p.velocity.x = Math.abs(p.velocity.x) * wallBounce;
        } else if (p.position.x > width) {
          p.position.x = width;
          p.velocity.x = -Math.abs(p.velocity.x) * wallBounce;
        }
        // 床・天井衝突
        if (p.position.y > height) {
          p.position.y = height;
          p.velocity.y = -Math.abs(p.velocity.y) * floorBounce;
          // 床で少し散らす
          p.velocity.x *= 0.9;
        } else if (p.position.y < 0) {
          p.position.y = 0;
          p.velocity.y = Math.abs(p.velocity.y) * wallBounce;
        }
        // フェード
        p.opacity = clamp(p.opacity - fadePerSecond * dt, 0, 1);
        p.life = p.opacity;
      }

      // デッドパーティクルを除去しない（破片を残す）
      // particles = particles.filter((p) => p.life > 0.02);

      // 描画
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i];
        ctx.save();
        ctx.translate(p.position.x, p.position.y);
        ctx.rotate(p.rotation);
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = p.color;
        // 破片はランダム多角形で描画
        ctx.beginPath();
        const verts = p.vertices;
        if (verts.length > 0) {
          ctx.moveTo(verts[0].x, verts[0].y);
          for (let k = 1; k < verts.length; k += 1) {
            ctx.lineTo(verts[k].x, verts[k].y);
          }
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }
      ctx.restore();

      animationRef.current = requestAnimationFrame(step);
    };

    lastTimestamp = performance.now();
    animationRef.current = requestAnimationFrame(step);

    return () => {
      detach();
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
      clearFragmentsRef.current = null;
      if (reappearTimeoutRef.current) {
        window.clearTimeout(reappearTimeoutRef.current);
        reappearTimeoutRef.current = null;
      }
    };
  }, [isRunning]);

  // マイク監視: -10dB以上が5秒継続で自動爆散
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    let stopped = false;

    const start = async () => {
      try {
        const supportsMedia = !!navigator.mediaDevices?.getUserMedia;
        if (!supportsMedia) return;
        const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
        const audioCtx: AudioContext = new AudioCtx();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.8;
        source.connect(analyser);
        const bufferLength = analyser.fftSize;
        const dataArray = new Float32Array(bufferLength);

        audioCtxRef.current = audioCtx;
        sourceRef.current = source;
        analyserRef.current = analyser;
        dataArrayRef.current = dataArray;

        const tick = () => {
          if (stopped) return;
          const analyserNode = analyserRef.current;
          const arr = dataArrayRef.current;
          if (!analyserNode || !arr) return;
          analyserNode.getFloatTimeDomainData(arr);
          let sumSquares = 0;
          for (let i = 0; i < arr.length; i++) {
            const v = arr[i];
            sumSquares += v * v;
          }
          const rms = Math.sqrt(sumSquares / arr.length);
          const min = 1e-8;
          const db = 20 * Math.log10(Math.max(rms, min));
          setDbLevel(db);

          const now = performance.now();
          const threshold = thresholdDb; // dB（設定値）
          const requiredMsLocal = requiredMs; // ms（設定値）
          if (db >= threshold) {
            if (aboveStartRef.current == null) aboveStartRef.current = now;
            const span = now - (aboveStartRef.current ?? now);
            if (span >= requiredMsLocal && !hasExploded) {
              // trigger explosion
              explodeRef.current?.();
            }
          } else {
            aboveStartRef.current = null;
          }
          micRafRef.current = window.requestAnimationFrame(tick);
        };
        micRafRef.current = window.requestAnimationFrame(tick);
      } catch {
        // ignore errors silently
      }
    };

    start();

    return () => {
      stopped = true;
      if (micRafRef.current) {
        cancelAnimationFrame(micRafRef.current);
        micRafRef.current = null;
      }
      if (audioCtxRef.current) {
        try {
          audioCtxRef.current.close();
        } catch {}
        audioCtxRef.current = null;
      }
      analyserRef.current = null;
      sourceRef.current = null;
      dataArrayRef.current = null;
      aboveStartRef.current = null;
    };
  }, [hasExploded]);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100dvh",
        overflow: "hidden",
        background:
          "radial-gradient(1200px 800px at 20% -10%, #ffb087 0%, transparent 60%), radial-gradient(1000px 700px at 120% 10%, #ff6a6a 0%, transparent 55%), #22060a",
      }}
    >
      {/* 背景の灼熱パルス */}
      <style>
        {`
        @keyframes bgShift { 
          0% { transform: rotate(0deg) scale(1); filter: brightness(1); }
          50% { transform: rotate(180deg) scale(1.05); filter: brightness(1.15); }
          100% { transform: rotate(360deg) scale(1); filter: brightness(1); }
        }
        @keyframes heatWave {
          0% { transform: translateY(0) skewX(0deg); opacity: 0.28; }
          50% { transform: translateY(-4%) skewX(2deg); opacity: 0.42; }
          100% { transform: translateY(0) skewX(0deg); opacity: 0.28; }
        }
        @keyframes flameRise {
          0% { background-position: 50% 100%, 60% 100%, 40% 100%; opacity: .65; }
          50% { background-position: 50% 0%, 60% 10%, 40% -10%; opacity: .9; }
          100% { background-position: 50% -100%, 60% -90%, 40% -110%; opacity: .65; }
        }
        @keyframes noiseFlicker {
          0%, 100% { opacity: .10; transform: scale(1); }
          25% { opacity: .16; transform: scale(1.012); }
          50% { opacity: .08; transform: scale(0.994); }
          75% { opacity: .2; transform: scale(1.02); }
        }
        @keyframes shimmerFlow {
          0% { background-position: 0% 100%; }
          100% { background-position: 0% -100%; }
        }
        @keyframes dropIn {
          0% { transform: translate3d(0, -60vh, 0); opacity: 0; filter: blur(6px); }
          60% { opacity: 1; }
          100% { transform: translate3d(0, 0, 0); opacity: 1; filter: blur(0); }
        }
      `}
      </style>
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "conic-gradient(from 45deg at 50% 50%, rgba(255,120,60,0.25), rgba(255,40,20,0.15), rgba(255,200,120,0.25), rgba(255,120,60,0.25))",
          mixBlendMode: "screen",
          animation: "bgShift 50s linear infinite",
          pointerEvents: "none",
        }}
      />
      {/* 炎の舌（立ち上るフレア） */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            [
              "radial-gradient(120px 220px at 50% 120%, rgba(255,160,60,.45) 0%, rgba(255,80,20,.25) 35%, rgba(255,0,0,0) 70%)",
              "radial-gradient(160px 260px at 60% 120%, rgba(255,200,80,.35) 0%, rgba(255,120,20,.18) 40%, rgba(255,0,0,0) 75%)",
              "radial-gradient(100px 200px at 40% 120%, rgba(255,120,60,.35) 0%, rgba(255,60,20,.18) 40%, rgba(255,0,0,0) 75%)",
            ].join(","),
          backgroundRepeat: "no-repeat",
          backgroundSize: "22% 70%, 26% 75%, 18% 65%",
          mixBlendMode: "screen",
          animation: "flameRise 3.2s ease-in-out infinite",
          filter: "blur(6px) saturate(1.2)",
          pointerEvents: "none",
        }}
      />
      {/* 細かな揺らぎノイズ（フリッカー） */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "repeating-conic-gradient(from 0deg at 50% 50%, rgba(255,255,255,.06) 0 8deg, transparent 8deg 16deg)",
          mixBlendMode: "overlay",
          animation: "noiseFlicker 380ms steps(3, end) infinite",
          filter: "blur(2px)",
          pointerEvents: "none",
        }}
      />
      {/* 熱ゆらぎ（蜃気楼）レイヤー */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "repeating-radial-gradient( circle at 50% 120%, rgba(255,255,255,0.08) 0 6px, transparent 6px 12px )",
          filter: "blur(8px)",
          animation: "heatWave 10s ease-in-out infinite",
          mixBlendMode: "soft-light",
          pointerEvents: "none",
        }}
      />
      {/* 追加の炎レイヤー（密度アップ） */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            [
              "radial-gradient(100px 200px at 45% 120%, rgba(255,200,90,.45) 0%, rgba(255,120,30,.20) 40%, rgba(255,0,0,0) 75%)",
              "radial-gradient(140px 220px at 55% 118%, rgba(255,160,60,.40) 0%, rgba(255,90,20,.22) 35%, rgba(255,0,0,0) 70%)",
              "radial-gradient(120px 240px at 50% 122%, rgba(255,180,70,.40) 0%, rgba(255,110,30,.20) 40%, rgba(255,0,0,0) 75%)",
            ].join(","),
          backgroundRepeat: "no-repeat",
          backgroundSize: "18% 60%, 22% 64%, 20% 68%",
          mixBlendMode: "screen",
          animation: "flameRise 10s ease-in-out infinite",
          filter: "blur(10px) saturate(1.25)",
          opacity: 0.9,
          pointerEvents: "none",
        }}
      />
      {/* 上昇する熱の筋（縦方向の揺らぎ） */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "repeating-linear-gradient( to right, rgba(255,150,80,.16) 0 14px, rgba(255,0,0,0) 14px 42px )",
          backgroundSize: "200% 200%",
          animation: "shimmerFlow 1.8s linear infinite",
          mixBlendMode: "screen",
          filter: "blur(8px)",
          pointerEvents: "none",
        }}
      />
      {/* コアの発光（中心部の強い熱） */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient( 600px 300px at 50% 80%, rgba(255,200,120,.25), rgba(255,120,40,.18) 40%, rgba(255,0,0,0) 70% )",
          mixBlendMode: "screen",
          animation: "bgShift 10s ease-in-out infinite",
          filter: "blur(14px) saturate(1.3)",
          pointerEvents: "none",
        }}
      />
      {/* ビネットで周辺を落とし中央の熱を強調 */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient( farthest-side at 50% 60%, rgba(0,0,0,0) 55%, rgba(0,0,0,.25) 100% )",
          pointerEvents: "none",
        }}
      />
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="クリックで『暑い』が爆散するキャンバス"
        style={{ display: "block", width: "100%", height: "100%", cursor: "crosshair" }}
      />
      {/* 設定ボタン（左上） */}
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={settingsOpen}
        aria-controls="settings-panel"
        aria-label="設定"
        onClick={() => setSettingsOpen((v) => !v)}
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          padding: 12,
          borderRadius: 8,
          border: "1px solid rgba(255,255,255,0.25)",
          background: "rgba(0,0,0,0.35)",
          color: "#fff",
          cursor: "pointer",
          backdropFilter: "blur(6px)",
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l.06.06a1.65 1.65 0 0 0-.33 1.82V9c0 .66.39 1.26 1 1.51.23.1.48.15.73.15H21a2 2 0 1 1 0 4h-.09c-.25 0-.5.05-.73.15-.61.25-1 .85-1 1.51z" />
        </svg>
      </button>

      {/* 設定パネル */}
      {settingsOpen && (
        <div
          role="dialog"
          aria-modal={false}
          id="settings-panel"
          aria-label="設定"
          style={{
            position: "absolute",
            top: 56,
            left: 12,
            width: 300,
            padding: 16,
            borderRadius: 12,
            background: "rgba(20,20,20,0.85)",
            color: "#fff",
            border: "1px solid rgba(255,255,255,0.2)",
            boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
            backdropFilter: "blur(8px)",
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>設定</div>
          <div style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, opacity: 0.9 }}>しきい値 (dB)</span>
              <input
                type="range"
                min={-60}
                max={0}
                step={1}
                value={thresholdDb}
                onChange={(e) => setThresholdDb(Number(e.target.value))}
                aria-label="しきい値 (dB)"
              />
              <input
                type="number"
                min={-60}
                max={0}
                step={1}
                value={thresholdDb}
                onChange={(e) => setThresholdDb(Number(e.target.value))}
                aria-label="しきい値 (dB)"
                style={{
                  padding: "6px 8px",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.25)",
                  background: "rgba(0,0,0,0.25)",
                  color: "#fff",
                }}
              />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, opacity: 0.9 }}>継続時間 (ms)</span>
              <input
                type="range"
                min={500}
                max={10000}
                step={100}
                value={requiredMs}
                onChange={(e) => setRequiredMs(Number(e.target.value))}
                aria-label="継続時間 (ms)"
              />
              <input
                type="number"
                min={0}
                max={60000}
                step={100}
                value={requiredMs}
                onChange={(e) => setRequiredMs(Number(e.target.value))}
                aria-label="継続時間 (ms)"
                style={{
                  padding: "6px 8px",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.25)",
                  background: "rgba(0,0,0,0.25)",
                  color: "#fff",
                }}
              />
            </label>

            <button
              type="button"
              onClick={() => setSettingsOpen(false)}
              style={{
                marginTop: 4,
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.25)",
                background: "rgba(255,255,255,0.12)",
                color: "#fff",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              閉じる
            </button>
            <button
              type="button"
              onClick={() => clearFragmentsRef.current?.()}
              aria-label="破片を削除"
              style={{
                marginTop: 6,
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.25)",
                background: "rgba(255,80,80,0.25)",
                color: "#fff",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              破片を削除
            </button>
          </div>
        </div>
      )}
      {/* 右側の縦型音量メーター（-60〜0 dB を 0〜100%に） */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: 48,
          padding: 10,
          display: "flex",
          alignItems: "flex-end",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            position: "relative",
            width: 16,
            height: "100%",
            borderRadius: 6,
            background: "rgba(255,255,255,0.12)",
            overflow: "hidden",
            boxShadow: "inset 0 0 0 1.5px rgba(0,0,0,0.28)",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: `${(() => {
                const db = dbLevel ?? -60;
                const minDb = -60;
                const maxDb = 0;
                const clamped = Math.max(minDb, Math.min(maxDb, db));
                return ((clamped - minDb) / (maxDb - minDb)) * 100;
              })()}%`,
              background: "linear-gradient(to top, #22c55e, #f59e0b, #ef4444)",
              filter: "saturate(1.2)",
              transition: "height 100ms linear",
            }}
          />
          {/* しきい値ライン */}
          <div
            style={{
              position: "absolute",
              left: -6,
              right: -6,
              height: 3,
              bottom: `${(() => {
                const db = thresholdDb;
                const minDb = -60;
                const maxDb = 0;
                const clamped = Math.max(minDb, Math.min(maxDb, db));
                return ((clamped - minDb) / (maxDb - minDb)) * 100;
              })()}%`,
              background: "rgba(255,255,255,0.9)",
              boxShadow: "0 0 8px rgba(255,255,255,0.75)",
              borderRadius: 3,
              pointerEvents: "none",
            }}
          />
        </div>
      </div>
      {/* 中央に 1 つだけ配置されたクリック可能な「暑い」 */}
      {!hasExploded && (
        <div
          ref={wordRef}
          role="button"
          aria-label="クリックで『暑い』が爆散します"
          tabIndex={0}
          onClick={() => (wordRef as any)._explodeHandler?.()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              (wordRef as any)._explodeHandler?.();
            }
          }}
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            color: "white",
            fontSize: 96,
            fontWeight: 900,
            textShadow: "0 4px 16px rgba(0,0,0,0.45)",
            cursor: "pointer",
            userSelect: "none",
            lineHeight: 1,
            letterSpacing: 4,
          }}
        >
          <div
            aria-hidden
            style={
              hasEverExploded
                ? {
                    animation: "dropIn 900ms cubic-bezier(0.2, 0.8, 0.2, 1) both",
                    willChange: "transform, opacity, filter",
                  }
                : undefined
            }
          >
            暑さ
          </div>
        </div>
      )}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "start center",
          pointerEvents: "none",
          paddingTop: "24px",
        }}
      >
      </div>
      {/* アクセシビリティ: Space で一時停止/再開 */}
      <KeyBinder onToggle={() => setIsRunning((v) => !v)} />
    </div>
  );
}

function KeyBinder({ onToggle }: { onToggle: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        onToggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onToggle]);
  return null;
}

export default App;
