'use strict';

const MODEL = Object.freeze({
  riskAversion: 2.5,
  tau: 0.05,
  lambda: 3.0,
  riskFree: 0.01,
  annualization: 252
});

const state = {
  assets: [],
  prices: [],
  returns: [],
  covariance: []
};

const $ = (id) => document.getElementById(id);
const SVG_NS = 'http://www.w3.org/2000/svg';

$('csvFile').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = parsePriceCSV(text);
    loadDataset(parsed.assets, parsed.prices, file.name);
  } catch (error) {
    setStatus(error.message, true);
  }
});

$('loadSampleBtn').addEventListener('click', () => {
  const sample = generateSampleData();
  loadDataset(sample.assets, sample.prices, 'サンプルデータ');
});

$('maxWeight').addEventListener('input', () => {
  $('maxWeightOutput').value = `${$('maxWeight').value}%`;
});

$('addViewBtn').addEventListener('click', () => {
  if (state.assets.length < 2) {
    setStatus('先に2資産以上のデータを読み込んでください。', true);
    return;
  }
  addView();
});

$('optimizeBtn').addEventListener('click', () => {
  try {
    optimizeAndRender();
  } catch (error) {
    setStatus(error.message, true);
  }
});

function setStatus(message, isError = false) {
  const el = $('dataStatus');
  el.textContent = message;
  el.style.color = isError ? '#b42318' : '';
}

function parsePriceCSV(text) {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 3) {
    throw new Error('CSVにはヘッダーと2行以上の価格データが必要です。');
  }

  const header = lines[0].split(',').map((x) => x.trim().replace(/^"|"$/g, ''));
  if (header.length < 3) {
    throw new Error('CSV形式は Date,Asset1,Asset2,... を想定しています。');
  }

  const assets = header.slice(1);
  const prices = [];

  for (let r = 1; r < lines.length; r++) {
    const fields = lines[r].split(',').map((x) => x.trim().replace(/^"|"$/g, ''));
    if (fields.length !== header.length) continue;

    const row = fields.slice(1).map(Number);
    if (row.every((x) => Number.isFinite(x) && x > 0)) {
      prices.push(row);
    }
  }

  if (prices.length < 3) {
    throw new Error('有効な正の価格データが3行以上必要です。');
  }

  return { assets, prices };
}

function loadDataset(assets, prices, sourceName) {
  state.assets = assets;
  state.prices = prices;
  state.returns = logReturns(prices);
  state.covariance = covarianceMatrix(state.returns, MODEL.annualization);

  $('views').replaceChildren();
  if (assets.length >= 2) addView();

  $('results').classList.add('hidden');
  setStatus(`${sourceName}: ${prices.length}日 / ${assets.length}資産を読み込みました。`);
}

function logReturns(prices) {
  const out = [];
  for (let t = 1; t < prices.length; t++) {
    out.push(prices[t].map((p, i) => Math.log(p / prices[t - 1][i])));
  }
  return out;
}

function covarianceMatrix(rows, annualization = 252) {
  const nObs = rows.length;
  const n = rows[0].length;
  if (nObs < 2) throw new Error('リターン系列が短すぎます。');

  const mean = Array(n).fill(0);
  for (const row of rows) {
    for (let i = 0; i < n; i++) mean[i] += row[i] / nObs;
  }

  const cov = matrix(n, n, 0);
  for (const row of rows) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        cov[i][j] += (row[i] - mean[i]) * (row[j] - mean[j]);
      }
    }
  }

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      cov[i][j] = (cov[i][j] / (nObs - 1)) * annualization;
    }
  }

  return regularizeCovariance(cov);
}

function regularizeCovariance(cov) {
  const n = cov.length;
  const avgVar = cov.reduce((s, row, i) => s + row[i], 0) / n;
  const ridge = Math.max(avgVar * 1e-8, 1e-12);
  return cov.map((row, i) =>
    row.map((value, j) => value + (i === j ? ridge : 0))
  );
}

function addView() {
  const fragment = $('viewTemplate').content.cloneNode(true);
  const row = fragment.querySelector('.view-row');
  const longSelect = fragment.querySelector('.view-long');
  const shortSelect = fragment.querySelector('.view-short');
  const confidence = fragment.querySelector('.view-confidence');
  const confidenceOutput = fragment.querySelector('.view-confidence-output');

  for (const asset of state.assets) {
    longSelect.add(new Option(asset, asset));
    shortSelect.add(new Option(asset, asset));
  }
  if (state.assets.length > 1) shortSelect.selectedIndex = 1;

  confidence.addEventListener('input', () => {
    confidenceOutput.value = `${confidence.value}%`;
  });

  fragment.querySelector('.remove-view').addEventListener('click', () => row.remove());
  $('views').append(fragment);
}

function collectViews() {
  const n = state.assets.length;
  const P = [];
  const Q = [];
  const confidences = [];

  for (const row of document.querySelectorAll('.view-row')) {
    const longAsset = row.querySelector('.view-long').value;
    const shortAsset = row.querySelector('.view-short').value;

    if (longAsset === shortAsset) {
      throw new Error('見通しでは異なる2資産を選んでください。');
    }

    const p = Array(n).fill(0);
    p[state.assets.indexOf(longAsset)] = 1;
    p[state.assets.indexOf(shortAsset)] = -1;

    const q = Number(row.querySelector('.view-return').value) / 100;
    const confidence = Number(row.querySelector('.view-confidence').value) / 100;

    if (!Number.isFinite(q)) throw new Error('見通しの期待超過リターンが不正です。');

    P.push(p);
    Q.push(q);
    confidences.push(clamp(confidence, 0.001, 0.999));
  }

  return { P, Q, confidences };
}

function blackLitterman(cov, marketWeights, delta, tau, views) {
  const prior = scaleVector(matVec(cov, marketWeights), delta);

  if (!views.P.length) {
    return { prior, posterior: prior.slice() };
  }

  const tauSigma = scaleMatrix(cov, tau);
  const invTauSigma = inverse(tauSigma);
  const omegaDiag = views.P.map((p, i) => {
    const variance = Math.max(dot(p, matVec(tauSigma, p)), 1e-12);
    const c = views.confidences[i];
    return Math.max(variance * ((1 - c) / c), 1e-12);
  });

  const invOmega = diagonal(omegaDiag.map((x) => 1 / x));
  const Pt = transpose(views.P);
  const precision = addMatrices(
    invTauSigma,
    matMul(matMul(Pt, invOmega), views.P)
  );
  const rhs = addVectors(
    matVec(invTauSigma, prior),
    matVec(matMul(Pt, invOmega), views.Q)
  );

  return {
    prior,
    posterior: matVec(inverse(precision), rhs)
  };
}

function optimizeAndRender() {
  if (!state.assets.length) {
    throw new Error('先にCSVまたはサンプルデータを読み込んでください。');
  }

  state.covariance = covarianceMatrix(state.returns, MODEL.annualization);

  const maxWeight = Number($('maxWeight').value) / 100;
  if (maxWeight * state.assets.length < 1 - 1e-12) {
    throw new Error(
      `1資産上限${(maxWeight * 100).toFixed(0)}%では、${state.assets.length}資産で合計100%にできません。`
    );
  }

  const marketWeights = Array(state.assets.length).fill(1 / state.assets.length);
  const views = collectViews();
  const bl = blackLitterman(
    state.covariance,
    marketWeights,
    MODEL.riskAversion,
    MODEL.tau,
    views
  );

  const weights = optimizeMeanVariance(
    bl.posterior,
    state.covariance,
    MODEL.lambda,
    maxWeight
  );

  const frontier = efficientFrontier(
    bl.posterior,
    state.covariance,
    maxWeight
  );

  renderResults(bl.prior, bl.posterior, weights, frontier);
  setStatus(`最適化完了: ${state.assets.length}資産 / 見通し${views.P.length}件`);
}

function optimizeMeanVariance(mu, cov, lambda, maxWeight) {
  const n = mu.length;
  let w = projectCappedSimplex(Array(n).fill(1 / n), maxWeight);

  const largestEigenvalue = Math.max(powerIterationLargestEigenvalue(cov), 1e-8);
  const step = 0.8 / (lambda * largestEigenvalue + 1e-12);

  for (let iter = 0; iter < 12000; iter++) {
    const sigmaW = matVec(cov, w);
    const gradient = mu.map((x, i) => x - lambda * sigmaW[i]);
    const proposal = w.map((x, i) => x + step * gradient[i]);
    const next = projectCappedSimplex(proposal, maxWeight);

    const diff = Math.sqrt(next.reduce((s, x, i) => s + (x - w[i]) ** 2, 0));
    w = next;
    if (diff < 1e-11) break;
  }

  return w;
}

function efficientFrontier(mu, cov, maxWeight) {
  const lambdas = logSpace(-1.4, 3.6, 64);
  const points = [];

  for (const lambda of lambdas) {
    const weights = optimizeMeanVariance(mu, cov, lambda, maxWeight);
    const expectedReturn = dot(mu, weights);
    const variance = dot(weights, matVec(cov, weights));
    const volatility = Math.sqrt(Math.max(variance, 0));

    const duplicate = points.some(
      (p) => Math.abs(p.volatility - volatility) < 1e-5 &&
             Math.abs(p.expectedReturn - expectedReturn) < 1e-5
    );
    if (!duplicate) points.push({ expectedReturn, volatility, weights });
  }

  points.sort((a, b) => a.volatility - b.volatility);
  return points;
}

function logSpace(startExp, endExp, count) {
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0 : i / (count - 1);
    return 10 ** (startExp + (endExp - startExp) * t);
  });
}

function projectCappedSimplex(v, cap) {
  const n = v.length;
  if (cap * n < 1 - 1e-12) {
    throw new Error('上限制約のためfully-investedポートフォリオを作れません。');
  }

  let lo = Math.min(...v) - cap - 1;
  let hi = Math.max(...v) + 1;

  for (let k = 0; k < 120; k++) {
    const theta = (lo + hi) / 2;
    const sum = v.reduce((s, x) => s + clamp(x - theta, 0, cap), 0);
    if (sum > 1) lo = theta;
    else hi = theta;
  }

  const theta = (lo + hi) / 2;
  const w = v.map((x) => clamp(x - theta, 0, cap));
  const sum = w.reduce((a, b) => a + b, 0);

  if (sum <= 0) throw new Error('最適化に失敗しました。');
  return w.map((x) => x / sum);
}

function renderResults(prior, posterior, weights, frontier) {
  const stats = portfolioStats(posterior, state.covariance, weights);

  $('metricReturn').textContent = formatPct(stats.expectedReturn);
  $('metricVol').textContent = formatPct(stats.volatility);
  $('metricSharpe').textContent = Number.isFinite(stats.sharpe)
    ? stats.sharpe.toFixed(2)
    : '—';

  renderAllocation(weights);
  renderFrontier(frontier, stats);
  renderForecast(stats.expectedReturn, stats.volatility);
  renderDetailTable(prior, posterior, weights);

  $('results').classList.remove('hidden');
}

function portfolioStats(mu, cov, weights) {
  const expectedReturn = dot(mu, weights);
  const variance = dot(weights, matVec(cov, weights));
  const volatility = Math.sqrt(Math.max(variance, 0));
  const sharpe = volatility > 0
    ? (expectedReturn - MODEL.riskFree) / volatility
    : NaN;

  return { expectedReturn, volatility, sharpe };
}

function renderAllocation(weights) {
  const chart = $('allocationChart');
  chart.replaceChildren();
  const maxShown = Math.max(...weights, 1e-12);

  weights
    .map((weight, i) => ({ asset: state.assets[i], weight }))
    .sort((a, b) => b.weight - a.weight)
    .forEach(({ asset, weight }) => {
      const row = document.createElement('div');
      row.className = 'bar-row';

      const label = document.createElement('span');
      label.textContent = asset;

      const track = document.createElement('div');
      track.className = 'bar-track';

      const fill = document.createElement('div');
      fill.className = 'bar-fill';
      fill.style.width = `${(weight / maxShown) * 100}%`;
      track.append(fill);

      const value = document.createElement('strong');
      value.textContent = formatPct(weight);

      row.append(label, track, value);
      chart.append(row);
    });
}

function renderFrontier(frontier, selected) {
  const root = $('frontierChart');
  root.replaceChildren();

  if (!frontier.length) return;

  const width = 560;
  const height = 250;
  const margin = { left: 54, right: 18, top: 16, bottom: 38 };
  const xValues = frontier.map((p) => p.volatility).concat(selected.volatility);
  const yValues = frontier.map((p) => p.expectedReturn).concat(selected.expectedReturn);
  const xMin = Math.max(0, Math.min(...xValues) * 0.92);
  const xMax = Math.max(...xValues) * 1.06;
  const yPad = Math.max((Math.max(...yValues) - Math.min(...yValues)) * 0.12, 0.005);
  const yMin = Math.min(...yValues) - yPad;
  const yMax = Math.max(...yValues) + yPad;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': 'Efficient frontier'
  });

  const sx = (x) => margin.left + ((x - xMin) / Math.max(xMax - xMin, 1e-12)) * (width - margin.left - margin.right);
  const sy = (y) => height - margin.bottom - ((y - yMin) / Math.max(yMax - yMin, 1e-12)) * (height - margin.top - margin.bottom);

  drawAxes(svg, { width, height, margin, xMin, xMax, yMin, yMax, sx, sy, xFormat: formatPctShort, yFormat: formatPctShort });

  const path = frontier.map((p, i) =>
    `${i === 0 ? 'M' : 'L'} ${sx(p.volatility).toFixed(2)} ${sy(p.expectedReturn).toFixed(2)}`
  ).join(' ');
  svg.append(svgEl('path', { d: path, class: 'frontier-line' }));

  for (const p of frontier) {
    svg.append(svgEl('circle', {
      cx: sx(p.volatility),
      cy: sy(p.expectedReturn),
      r: 2.3,
      class: 'frontier-point'
    }));
  }

  svg.append(svgEl('circle', {
    cx: sx(selected.volatility),
    cy: sy(selected.expectedReturn),
    r: 5.5,
    class: 'selected-point'
  }));

  const label = svgEl('text', {
    x: sx(selected.volatility) + 8,
    y: sy(selected.expectedReturn) - 8,
    class: 'chart-label'
  });
  label.textContent = '選択ポートフォリオ';
  svg.append(label);

  root.append(svg);
}

function renderForecast(mu, sigma) {
  const root = $('forecastChart');
  root.replaceChildren();

  const horizon = 10;
  const steps = 40;
  const data = [];

  for (let i = 0; i <= steps; i++) {
    const t = horizon * i / steps;
    const median = 100 * Math.exp((mu - 0.5 * sigma ** 2) * t);
    const p10 = 100 * Math.exp((mu - 0.5 * sigma ** 2) * t - 1.2815515655 * sigma * Math.sqrt(t));
    const p25 = 100 * Math.exp((mu - 0.5 * sigma ** 2) * t - 0.6744897502 * sigma * Math.sqrt(t));
    const p75 = 100 * Math.exp((mu - 0.5 * sigma ** 2) * t + 0.6744897502 * sigma * Math.sqrt(t));
    const p90 = 100 * Math.exp((mu - 0.5 * sigma ** 2) * t + 1.2815515655 * sigma * Math.sqrt(t));
    data.push({ t, median, p10, p25, p75, p90 });
  }

  const width = 1120;
  const height = 280;
  const margin = { left: 56, right: 20, top: 14, bottom: 38 };
  const yMinRaw = Math.min(...data.map((d) => d.p10));
  const yMaxRaw = Math.max(...data.map((d) => d.p90));
  const yPad = Math.max((yMaxRaw - yMinRaw) * 0.06, 5);
  const yMin = Math.max(0, yMinRaw - yPad);
  const yMax = yMaxRaw + yPad;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': 'Ten year forecast range'
  });

  const sx = (x) => margin.left + (x / horizon) * (width - margin.left - margin.right);
  const sy = (y) => height - margin.bottom - ((y - yMin) / Math.max(yMax - yMin, 1e-12)) * (height - margin.top - margin.bottom);

  drawAxes(svg, {
    width, height, margin,
    xMin: 0, xMax: horizon, yMin, yMax, sx, sy,
    xFormat: (x) => `${Math.round(x)}年`,
    yFormat: (y) => Math.round(y).toString()
  });

  svg.append(svgEl('path', {
    d: areaPath(data, sx, sy, 'p90', 'p10'),
    class: 'forecast-wide'
  }));
  svg.append(svgEl('path', {
    d: areaPath(data, sx, sy, 'p75', 'p25'),
    class: 'forecast-inner'
  }));
  svg.append(svgEl('path', {
    d: linePath(data, sx, sy, 'median'),
    class: 'forecast-median'
  }));

  root.append(svg);
  renderForecastSummary(mu, sigma);
}

function renderForecastSummary(mu, sigma) {
  const root = $('forecastSummary');
  root.replaceChildren();

  for (const years of [1, 5, 10]) {
    const drift = (mu - 0.5 * sigma ** 2) * years;
    const spread = sigma * Math.sqrt(years);
    const medianReturn = Math.exp(drift) - 1;
    const low = Math.exp(drift - 1.2815515655 * spread) - 1;
    const high = Math.exp(drift + 1.2815515655 * spread) - 1;

    const chip = document.createElement('div');
    chip.className = 'forecast-chip';

    const label = document.createElement('span');
    label.textContent = `${years}年後`;

    const value = document.createElement('strong');
    value.textContent = `中央値 ${formatPct(medianReturn)}　80%範囲 ${formatPct(low)} ～ ${formatPct(high)}`;

    chip.append(label, value);
    root.append(chip);
  }
}

function renderDetailTable(prior, posterior, weights) {
  const table = $('resultsTable');
  table.replaceChildren();

  state.assets.forEach((asset, i) => {
    const tr = document.createElement('tr');
    [asset, formatPct(prior[i]), formatPct(posterior[i]), formatPct(weights[i])]
      .forEach((value) => {
        const td = document.createElement('td');
        td.textContent = value;
        tr.append(td);
      });
    table.append(tr);
  });
}

function drawAxes(svg, cfg) {
  const { width, height, margin, xMin, xMax, yMin, yMax, sx, sy, xFormat, yFormat } = cfg;
  const xTicks = 5;
  const yTicks = 4;

  for (let i = 0; i <= xTicks; i++) {
    const value = xMin + (xMax - xMin) * i / xTicks;
    const x = sx(value);
    svg.append(svgEl('line', { x1: x, y1: margin.top, x2: x, y2: height - margin.bottom, class: 'chart-grid' }));
    const text = svgEl('text', { x, y: height - 14, 'text-anchor': 'middle', class: 'chart-label' });
    text.textContent = xFormat(value);
    svg.append(text);
  }

  for (let i = 0; i <= yTicks; i++) {
    const value = yMin + (yMax - yMin) * i / yTicks;
    const y = sy(value);
    svg.append(svgEl('line', { x1: margin.left, y1: y, x2: width - margin.right, y2: y, class: 'chart-grid' }));
    const text = svgEl('text', { x: margin.left - 8, y: y + 4, 'text-anchor': 'end', class: 'chart-label' });
    text.textContent = yFormat(value);
    svg.append(text);
  }

  svg.append(svgEl('line', {
    x1: margin.left,
    y1: height - margin.bottom,
    x2: width - margin.right,
    y2: height - margin.bottom,
    class: 'chart-axis'
  }));
  svg.append(svgEl('line', {
    x1: margin.left,
    y1: margin.top,
    x2: margin.left,
    y2: height - margin.bottom,
    class: 'chart-axis'
  }));
}

function areaPath(data, sx, sy, upperKey, lowerKey) {
  const upper = data.map((d, i) =>
    `${i === 0 ? 'M' : 'L'} ${sx(d.t).toFixed(2)} ${sy(d[upperKey]).toFixed(2)}`
  ).join(' ');
  const lower = [...data].reverse().map((d) =>
    `L ${sx(d.t).toFixed(2)} ${sy(d[lowerKey]).toFixed(2)}`
  ).join(' ');
  return `${upper} ${lower} Z`;
}

function linePath(data, sx, sy, key) {
  return data.map((d, i) =>
    `${i === 0 ? 'M' : 'L'} ${sx(d.t).toFixed(2)} ${sy(d[key]).toFixed(2)}`
  ).join(' ');
}

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, String(value));
  }
  return el;
}

function powerIterationLargestEigenvalue(a) {
  const n = a.length;
  let v = Array(n).fill(1 / Math.sqrt(n));

  for (let k = 0; k < 100; k++) {
    const av = matVec(a, v);
    const norm = Math.sqrt(dot(av, av));
    if (norm < 1e-15) return 0;
    v = av.map((x) => x / norm);
  }

  return Math.abs(dot(v, matVec(a, v)));
}

function generateSampleData() {
  const assets = ['All Country', 'S&P 500', 'NASDAQ 100', 'TOPIX', 'Gold'];
  const annualMu = [0.065, 0.075, 0.095, 0.055, 0.035];
  const annualVol = [0.16, 0.18, 0.24, 0.17, 0.15];
  const factorLoading = [0.75, 0.82, 0.88, 0.62, 0.12];
  const days = 756;
  const prices = [Array(assets.length).fill(100)];
  const random = seededRandom(20261002);

  for (let t = 1; t < days; t++) {
    const marketShock = normalRandom(random);
    const previous = prices[t - 1];
    const next = [];

    for (let i = 0; i < assets.length; i++) {
      const idioShock = normalRandom(random);
      const loading = factorLoading[i];
      const z = loading * marketShock + Math.sqrt(1 - loading ** 2) * idioShock;
      const dailyMu = annualMu[i] / 252;
      const dailyVol = annualVol[i] / Math.sqrt(252);
      next.push(previous[i] * Math.exp(dailyMu - 0.5 * dailyVol ** 2 + dailyVol * z));
    }
    prices.push(next);
  }

  return { assets, prices };
}

function seededRandom(seed) {
  let x = seed >>> 0;
  return () => {
    x = (1664525 * x + 1013904223) >>> 0;
    return (x + 0.5) / 4294967296;
  };
}

function normalRandom(random) {
  const u1 = Math.max(random(), 1e-12);
  const u2 = random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function matrix(rows, cols, fill = 0) {
  return Array.from({ length: rows }, () => Array(cols).fill(fill));
}

function diagonal(values) {
  return values.map((value, i) =>
    values.map((_, j) => (i === j ? value : 0))
  );
}

function transpose(a) {
  return a[0].map((_, j) => a.map((row) => row[j]));
}

function matMul(a, b) {
  const rows = a.length;
  const cols = b[0].length;
  const inner = b.length;
  const out = matrix(rows, cols, 0);

  for (let i = 0; i < rows; i++) {
    for (let k = 0; k < inner; k++) {
      const aik = a[i][k];
      for (let j = 0; j < cols; j++) {
        out[i][j] += aik * b[k][j];
      }
    }
  }
  return out;
}

function matVec(a, v) {
  return a.map((row) => dot(row, v));
}

function addMatrices(a, b) {
  return a.map((row, i) => row.map((x, j) => x + b[i][j]));
}

function addVectors(a, b) {
  return a.map((x, i) => x + b[i]);
}

function scaleMatrix(a, scalar) {
  return a.map((row) => row.map((x) => x * scalar));
}

function scaleVector(v, scalar) {
  return v.map((x) => x * scalar);
}

function dot(a, b) {
  return a.reduce((sum, x, i) => sum + x * b[i], 0);
}

function inverse(a) {
  const n = a.length;
  if (!n || a.some((row) => row.length !== n)) {
    throw new Error('逆行列は正方行列に対してのみ計算できます。');
  }

  const aug = a.map((row, i) => [
    ...row.map(Number),
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
  ]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(aug[r][col]) > Math.abs(aug[pivot][col])) pivot = r;
    }

    if (Math.abs(aug[pivot][col]) < 1e-14) {
      throw new Error('行列が特異です。価格系列または見通しを見直してください。');
    }

    [aug[col], aug[pivot]] = [aug[pivot], aug[col]];

    const pivotValue = aug[col][col];
    for (let j = 0; j < 2 * n; j++) aug[col][j] /= pivotValue;

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = aug[r][col];
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j++) {
        aug[r][j] -= factor * aug[col][j];
      }
    }
  }

  return aug.map((row) => row.slice(n));
}

function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

function formatPct(x) {
  return `${(100 * x).toFixed(1)}%`;
}

function formatPctShort(x) {
  return `${(100 * x).toFixed(0)}%`;
}
