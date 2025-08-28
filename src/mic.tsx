import { useEffect, useMemo, useRef, useState } from "react";
import type { Route } from "./+types/mic";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Microphone Volume Meter" },
    { name: "description", content: "Realtime dB meter from microphone input" },
  ];
}

type MeterState = {
  db: number | null;
  rms: number | null;
  permission: "prompt" | "granted" | "denied" | "unsupported";
  errorMessage?: string;
};

export default function MicPage() {
  const [state, setState] = useState<MeterState>({
    db: null,
    rms: null,
    permission: "prompt",
  });

  const rafRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const dataArrayRef = useRef<Float32Array | null>(null);

  const supportsMedia = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  const { isSecure, isLocalhost } = useMemo(() => {
    if (typeof window === "undefined") return { isSecure: false, isLocalhost: false };
    const host = window.location.hostname;
    const localhostLike = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
    return { isSecure: window.isSecureContext === true, isLocalhost: localhostLike };
  }, []);
  const canUseMicInThisContext = supportsMedia && (isSecure || isLocalhost);

  useEffect(() => {
    if (!supportsMedia) {
      setState((s) => ({ ...s, permission: "unsupported", errorMessage: "このブラウザはマイク取得に対応していません" }));
      return;
    }
    if (!canUseMicInThisContext) {
      setState((s) => ({
        ...s,
        permission: "denied",
        errorMessage:
          "このオリジンではマイクを使用できません。HTTPS か、http://localhost でアクセスしてください。",
      }));
    }
  }, [supportsMedia, canUseMicInThisContext]);

  const start = async () => {
    try {
      if (!canUseMicInThisContext) {
        throw new Error("非セキュアな HTTP では localhost/127.0.0.1/[::1] 以外でマイクは使用できません");
      }
      // Permissions API は Safari では限定的
      if ("permissions" in navigator && (navigator as any).permissions?.query) {
        try {
          const result = await (navigator as any).permissions.query({ name: "microphone" as any });
          setState((s) => ({ ...s, permission: result.state as MeterState["permission"] }));
        } catch {
          // 無視（非対応ブラウザ）
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });

      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
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
        const analyserNode = analyserRef.current;
        const arr = dataArrayRef.current;
        if (!analyserNode || !arr) return;
        analyserNode.getFloatTimeDomainData(arr);
        // RMS 計算
        let sumSquares = 0;
        for (let i = 0; i < arr.length; i++) {
          const v = arr[i];
          sumSquares += v * v;
        }
        const rms = Math.sqrt(sumSquares / arr.length);
        // dB に変換（相対）。無音対策で最小値をクリップ
        const min = 1e-8;
        const db = 20 * Math.log10(Math.max(rms, min));
        setState((s) => ({ ...s, db, rms }));
        rafRef.current = window.requestAnimationFrame(tick);
      };
      rafRef.current = window.requestAnimationFrame(tick);
      setState((s) => ({ ...s, permission: "granted" }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "マイク取得に失敗しました";
      setState((s) => ({ ...s, permission: "denied", errorMessage: message }));
    }
  };

  const stop = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioCtxRef.current) {
      try {
        audioCtxRef.current.close();
      } catch {}
      audioCtxRef.current = null;
    }
    setState((s) => ({ ...s, db: null, rms: null }));
  };

  useEffect(() => {
    return () => {
      stop();
    };
  }, []);

  const levelPct = useMemo(() => {
    // dB(-60〜0) を 0〜100% にマッピング
    if (state.db == null) return 0;
    const minDb = -60;
    const maxDb = 0;
    const clamped = Math.max(minDb, Math.min(maxDb, state.db));
    return ((clamped - minDb) / (maxDb - minDb)) * 100;
  }, [state.db]);

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1 className="text-xl font-semibold">マイク音量メーター</h1>
      <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">HTTPS 環境で動作します。ボタンを押して許可してください。</p>

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={start}
          className="rounded-md bg-blue-600 text-white px-4 py-2 disabled:opacity-50"
          disabled={!canUseMicInThisContext || state.permission === "granted"}
          aria-disabled={!canUseMicInThisContext || state.permission === "granted"}
        >
          マイク開始
        </button>
        <button
          type="button"
          onClick={stop}
          className="rounded-md border px-4 py-2"
          disabled={state.permission !== "granted"}
          aria-disabled={state.permission !== "granted"}
        >
          停止
        </button>
        <span className="text-sm">状態: {state.permission}</span>
      </div>

      {state.errorMessage && (
        <p className="mt-2 text-red-600 text-sm" role="alert">{state.errorMessage}</p>
      )}

      {!isSecure && !isLocalhost && (
        <div className="mt-3 text-xs text-gray-600 dark:text-gray-300">
          <p>
            現在の接続は HTTP です。この機能はブラウザの制約により HTTPS でのみ利用可能です。
            ローカル開発では <code>http://localhost</code> / <code>127.0.0.1</code> / <code>[::1]</code> であれば動作します。
          </p>
        </div>
      )}

      <section className="mt-8 max-w-xl">
        <label className="block mb-2 text-sm" htmlFor="meter" aria-live="polite">
          現在の音量（dB 相対）: {state.db?.toFixed(1) ?? "--"} dB
        </label>
        <div id="meter" className="h-4 w-full rounded bg-gray-200 dark:bg-gray-700" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(levelPct)}>
          <div
            className="h-4 rounded bg-green-500 transition-[width] duration-100"
            style={{ width: `${levelPct}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-gray-500">-60 dB（左）〜 0 dB（右）</p>
      </section>
    </main>
  );
}


