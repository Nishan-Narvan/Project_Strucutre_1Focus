"use client";

import { useEffect, useRef, useState } from "react";

let initialised = false;

export function Mermaid({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mermaid = (await import("mermaid")).default;
      if (!initialised) {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          themeVariables: {
            darkMode: true,
            background: "#1c1916",
            primaryColor: "#25211d",
            primaryTextColor: "#ece6df",
            primaryBorderColor: "#d97757",
            lineColor: "#9a9087",
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
          },
        });
        initialised = true;
      }
      const id = "mm" + Math.random().toString(36).slice(2);
      try {
        const clean = code.replace(/^```(?:mermaid)?\s*|```\s*$/g, "").trim();
        const { svg } = await mermaid.render(id, clean);
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      } catch {
        document.getElementById("d" + id)?.remove();
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error)
    return (
      <div>
        <p className="mb-2 text-sm text-muted">Diagram could not be rendered — source:</p>
        <pre className="overflow-x-auto rounded-lg bg-bg p-3 text-xs text-muted">{code}</pre>
      </div>
    );
  return <div ref={ref} className="diagram flex min-h-24 justify-center overflow-x-auto" />;
}
