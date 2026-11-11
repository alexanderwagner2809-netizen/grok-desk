/* Home line, coin candles, analyst score ring. devicePixelRatio-aware <canvas>. */
(function (global) {
  const GREEN = "#00d35a";
  const RED = "#ff453a";
  const ORANGE = "#ff9f0a";
  const BLUE = "#0a84ff";
  const YELLOW = "#ffd60a";
  const MUTED = "rgba(235,235,245,0.6)";

  function reduceMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function setup(canvas, cssW, cssH) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = cssW || canvas.clientWidth || 358;
    const h = cssH || canvas.clientHeight || 200;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h, dpr };
  }

  function clear(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
  }

  function niceRange(min, max) {
    if (min === max) {
      const pad = Math.max(Math.abs(min) * 0.04, min === 0 ? 1 : Math.abs(min) * 0.02);
      return { min: min - pad, max: max + pad };
    }
    const pad = (max - min) * 0.12;
    return { min: min - pad, max: max + pad };
  }

  function xOf(t, t0, t1, left, width) {
    if (t1 === t0) return left + width / 2;
    return left + ((t - t0) / (t1 - t0)) * width;
  }

  function yOf(v, vmin, vmax, top, height) {
    if (vmax === vmin) return top + height / 2;
    return top + (1 - (v - vmin) / (vmax - vmin)) * height;
  }

  function drawEmptyLine(ctx, w, h, start, message) {
    const padL = 8, padR = 8, padT = 28, padB = 18;
    const ymin = start * 0.96, ymax = start * 1.04 || 1;
    const y = yOf(start, ymin, ymax, padT, h - padT - padB);
    ctx.save();
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = "rgba(235,235,245,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = MUTED;
    ctx.font = "15px 'SF Pro Text', -apple-system, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(message || "Waiting for the first trade", w / 2, h / 2 + 10);
    ctx.restore();
  }

  const lineAnim = new WeakMap();

  function line(canvas, opts) {
    const points = (opts && opts.points) || [];
    const marks = (opts && opts.marks) || [];
    const start = opts && opts.start != null ? opts.start : (points[0] && points[0].value);
    const empty = !!(opts && opts.empty) || points.length === 0;
    const { ctx, w, h } = setup(canvas);
    clear(ctx, w, h);

    if (empty || points.length < 1) {
      drawEmptyLine(ctx, w, h, start != null ? start : 200, "Waiting for the first trade");
      return;
    }

    const padL = 8, padR = 8, padT = 36, padB = 16;
    const t0 = points[0].t;
    const t1 = points[points.length - 1].t;
    const vals = points.map((p) => p.value);
    if (start != null) vals.push(start);
    const nr = niceRange(Math.min.apply(null, vals), Math.max.apply(null, vals));
    const left = padL, width = w - padL - padR, top = padT, height = h - padT - padB;

    // Dashed start line
    if (start != null) {
      const ys = yOf(start, nr.min, nr.max, top, height);
      ctx.save();
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = "rgba(235,235,245,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left, ys);
      ctx.lineTo(left + width, ys);
      ctx.stroke();
      ctx.restore();
    }

    const path = new Path2D();
    points.forEach((p, i) => {
      const x = xOf(p.t, t0, t1, left, width);
      const y = yOf(p.value, nr.min, nr.max, top, height);
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    });

    const last = points[points.length - 1];
    const xLast = xOf(last.t, t0, t1, left, width);
    const yLast = yOf(last.value, nr.min, nr.max, top, height);
    const xFirst = xOf(points[0].t, t0, t1, left, width);
    const yBase = top + height;

    const fill = new Path2D(path);
    fill.lineTo(xLast, yBase);
    fill.lineTo(xFirst, yBase);
    fill.closePath();

    const grad = ctx.createLinearGradient(0, top, 0, yBase);
    grad.addColorStop(0, "rgba(0,211,90,0.32)");
    grad.addColorStop(1, "rgba(0,211,90,0.00)");
    ctx.fillStyle = grad;
    ctx.fill(fill);

    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke(path);

    // Marks above the line, later marks that would overlap move up a row.
    const placed = [];
    const rowH = 16;
    marks.forEach((m) => {
      const x = xOf(m.t, t0, t1, left, width);
      const yLine = yOf(valueAt(points, m.t), nr.min, nr.max, top, height);
      let row = 0;
      let label = m.label || "";
      ctx.font = "11px 'SF Pro Text', -apple-system, system-ui, sans-serif";
      const tw = ctx.measureText(label).width;
      let y = yLine - 12;
      function overlaps(xx, yy, ww) {
        return placed.some((p) => Math.abs(p.x - xx) < (p.w + ww) / 2 + 6 && Math.abs(p.y - yy) < rowH);
      }
      while (overlaps(x, y, tw) && row < 6) {
        row += 1;
        y = yLine - 12 - row * rowH;
      }
      if (y < 10) y = 10;
      placed.push({ x, y, w: tw });
      const tone = m.tone === "red" ? RED : m.tone === "green" ? GREEN : BLUE;
      ctx.fillStyle = tone;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.globalAlpha = 1;
      ctx.fillText(label, Math.max(tw / 2 + 2, Math.min(w - tw / 2 - 2, x)), y);
    });
  }

  function valueAt(points, t) {
    if (!points.length) return 0;
    if (t <= points[0].t) return points[0].value;
    for (let i = 1; i < points.length; i++) {
      if (t <= points[i].t) {
        const a = points[i - 1], b = points[i];
        const u = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
        return a.value + (b.value - a.value) * u;
      }
    }
    return points[points.length - 1].value;
  }

  function candles(canvas, opts) {
    const rows = (opts && opts.candles) || [];
    const trail = opts && opts.trail;
    const { ctx, w, h } = setup(canvas);
    clear(ctx, w, h);
    if (!rows.length) {
      ctx.fillStyle = MUTED;
      ctx.font = "15px 'SF Pro Text', -apple-system, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Waiting for the first trade", w / 2, h / 2);
      return;
    }
    const volH = 36;
    const padL = 6, padR = 6, padT = 10, padB = 4;
    const plotH = h - padT - padB - volH - 8;
    const highs = rows.map((c) => c.h);
    const lows = rows.map((c) => c.l);
    if (trail != null) {
      highs.push(trail);
      lows.push(trail);
    }
    const nr = niceRange(Math.min.apply(null, lows), Math.max.apply(null, highs));
    const t0 = rows[0].t;
    const t1 = rows[rows.length - 1].t;
    const spanT = Math.max(60, t1 - t0);
    const plotW = w - padL - padR;
    const slot = plotW * (60 / spanT);
    const bodyW = Math.max(2, Math.min(8, slot * 0.7 || 4));

    if (trail != null) {
      const y = yOf(trail, nr.min, nr.max, padT, plotH);
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = ORANGE;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = ORANGE;
      ctx.font = "11px 'SF Pro Text', -apple-system, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText("Risk trailing stop", padL + 2, y - 3);
      ctx.restore();
    }

    const maxV = Math.max.apply(null, rows.map((c) => c.v || 0)) || 1;
    rows.forEach((c, i) => {
      const x = padL + ((c.t - t0) / spanT) * plotW;
      const up = c.c >= c.o;
      ctx.strokeStyle = up ? GREEN : RED;
      ctx.fillStyle = up ? GREEN : RED;
      const yH = yOf(c.h, nr.min, nr.max, padT, plotH);
      const yL = yOf(c.l, nr.min, nr.max, padT, plotH);
      const yO = yOf(c.o, nr.min, nr.max, padT, plotH);
      const yC = yOf(c.c, nr.min, nr.max, padT, plotH);
      ctx.beginPath();
      ctx.moveTo(x, yH);
      ctx.lineTo(x, yL);
      ctx.lineWidth = 1;
      ctx.stroke();
      const top = Math.min(yO, yC);
      const bh = Math.max(3, Math.abs(yC - yO));
      ctx.fillRect(x - bodyW / 2, top, bodyW, bh);
      const vh = c.v ? Math.max(2, ((c.v || 0) / maxV) * volH) : 0;
      ctx.globalAlpha = 0.7;
      ctx.fillRect(x - bodyW / 2, h - padB - vh, bodyW, vh);
      ctx.globalAlpha = 1;
    });
  }

  function ring(canvas, opts) {
    const score = opts && opts.score;
    const min = opts && opts.min != null ? opts.min : 70;
    const { ctx, w, h } = setup(canvas);
    clear(ctx, w, h);
    const cx = w / 2, cy = h / 2;
    const r = Math.min(w, h) * 0.38;
    const lw = 7;
    ctx.lineCap = "round";
    ctx.lineWidth = lw;
    ctx.strokeStyle = "#2c2c2e";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    // threshold tick at min
    const tickA = -Math.PI / 2 + (min / 100) * Math.PI * 2;
    ctx.strokeStyle = "rgba(235,235,245,0.45)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(tickA) * (r - 8), cy + Math.sin(tickA) * (r - 8));
    ctx.lineTo(cx + Math.cos(tickA) * (r + 8), cy + Math.sin(tickA) * (r + 8));
    ctx.stroke();
    if (score == null) return;
    const col = score >= min ? GREEN : YELLOW;
    const a = (Math.max(0, Math.min(100, score)) / 100) * Math.PI * 2;
    ctx.strokeStyle = col;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + a);
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "600 22px 'SF Pro Display', 'SF Pro Text', -apple-system, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(Math.round(score)), cx, cy);
  }

  global.ChartKit = { line, candles, ring, reduceMotion, GREEN, RED, ORANGE, BLUE };
})(window);
