'use strict';

const state = {
  assets: [],
  prices: [],
  returns: [],
  covariance: [],
  marketWeights: []
};

const $ = (id) => document.getElementById(id);

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
  loadDataset(sample.assets, sample.prices, 'built-in synthetic sample');
});

$('equalWeightsBtn').addEventListener('click', () => {
  if (!state.assets.length) return;
  state.marketWeights = Array(state.assets.length).fill(1 / state.assets.length);
  renderMarketWeights();
});

$('addViewBtn').addEventListener('click', () => {
  if (state.assets.length < 2) {
    setStatus('2資産以上の価格データを先に読み込んでください。', true);
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
  el.style.borderColor = isError ? '#f0b7b2' : '';
  el.style.background = isError ? '#fff4f2' : '';
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
  state.covariance = covarianceMatrix(
    state.returns,
    Number($('annualization').value) || 252
  );
  state.marketWeights = Array(assets.length).fill(1 / assets.length);

  renderMarketWeights();
  $('views').replaceChildren();
  if (assets.length >= 2) addView();

  $('results').classList.add('hidden');
  setStatus(
    `${sourceName}: ${prices.length} observations / ${assets.length} assets loaded.`
  );
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

  const denom = nObs - 1;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      cov[i][j] = (cov[i][j] / denom) * annualization;
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

function renderMarketWeights() {
  const root = $('marketWeights');
  root.replaceChildren();

  state.assets.forEach((asset, i) => {
    const row = document.createElement('div');
    row.className = 'weight-row';

    const name = document.createElement('strong');
    name.textContent = asset;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.step = '0.5';
    slider.value = String(state.marketWeights[i] * 100);

    const value = document.createElement('span');
    value.className = 'weight-value';
    value.textContent = `${Number(slider.value).toFixed(1)}%`;

    slider.addEventListener('input', () => {
      state.marketWeights[i] = Number(slider.value) / 100;
      value.textContent = `${Number(slider.value).toFixed(1)}%`;
    });

    row.append(name, slider, value);
    root.append(row);
  });
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

  fragment.querySelector('.remove-view').addEventListener('click', () => {
    row.remove();
  });

  $('views').append(fragment);
}

function getNormalizedMarketWeights() {
  const raw = state.marketWeights.map((x) => Math.max(0, Number(x) || 0));
  const total = raw.reduce((a, b) => a + b, 0);
  if (total <= 0) {
    throw new Error('Market weightsの合計を0より大きくしてください。');
  }
  return raw.map((x) => x / total);
}

function collectViews() {
  const n = state.assets.length;
  const rows = [...document.querySelectorAll('.view-row')];
  const P = [];
  const Q = [];
  const confidences = [];

  for (const row of rows) {
    const longAsset = row.querySelector('.view-long').value;
    const shortAsset = row.querySelector('.view-short').value;
    if (longAsset === shortAsset) {
      throw new Error('Viewの比較対象は異なる資産を選んでください。');
    }

    const p = Array(n).fill(0);
    p[state.assets.indexOf(longAsset)] = 1;
    p[state.assets.indexOf(shortAsset)] = -1;

    const q = Number(row.querySelector('.view-return').value) / 100;
    const confidence = Number(row.querySelector('.view-confidence').value) / 100;

    if (!Number.isFinite(q)) throw new Error('Viewの期待超過リターンが不正です。');

    P.push(p);
    Q.push(q);
    confidences.push(clamp(confidence, 0.001, 0.999));
  }

  return { P, Q, confidences };
}

function blackLitterman(cov, marketWeights, delta, tau, views) {
  const n = cov.length;
  const prior = scaleVector(matVec(cov, marketWeights), delta);

  if (!views.P.length) {
    return { prior, posterior: prior.slice() };
  }

  const tauSigma = scaleMatrix(cov, tau);
  const invTauSigma = inverse(tauSigma);

  const m = views.P.length;
  const omegaDiag = [];

  for (let i = 0; i < m; i++) {
    const p = views.P[i];
    const viewVariance = Math.max(dot(p, matVec(tauSigma, p)), 1e-12);
    const c = views.confidences[i];
    omegaDiag.push(Math.max(viewVariance * ((1 - c) / c), 1e-12));
  }

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

  const posterior = matVec(inverse(precision), rhs);
  return { prior, posterior };
}

function optimizeAndRender() {
  if (!state.assets.length) {
    throw new Error('先にCSVまたはサンプルデータを読み込んでください。');
  }

  const annualization = Number($('annualization').value) || 252;
  state.covariance = covarianceMatrix(state.returns, annualization);

  const delta = positiveNumber('riskAversion', 'Risk aversion δ');
  const tau = positiveNumber('tau', 'τ');
  const lambda = positiveNumber('lambda', 'Optimizer λ');
  const maxWeight = Number($('maxWeight').value);
  const riskFree = Number($('riskFree').value);

  if (!(maxWeight > 0 && maxWeight <= 1)) {
    throw new Error('Max weightは0より大きく1以下にしてください。');
  }
  if (maxWeight * state.assets.length < 1 - 1e-12) {
    throw new Error(
      `Max weight=${(maxWeight * 100).toFixed(1)}%では全資産を合わせても100%にできません。`
    );
  }
  if (!Number.isFinite(riskFree)) {
    throw new Error('Risk-free rateが不正です。');
  }

  const marketWeights = getNormalizedMarketWeights();
  const views = collectViews();
  const bl = blackLitterman(
    state.covariance,
    marketWeights,
    delta,
    tau,
    views
  );

  const weights = optimizeMeanVariance(
    bl.posterior,
    state.covariance,
    lambda,
    maxWeight
  );

  renderResults(bl.prior, bl.posterior, weights, riskFree);
  setStatus(
    `Optimization complete: ${state.assets.length} assets, ${views.P.length} investor view(s).`
  );
}

function positiveNumber(id, label) {
  const x = Number($(id).value);
  if (!(x > 0) || !Number.isFinite(x)) {
    throw new Error(`${label}は正の数にしてください。`);
  }
  return x;
}

function optimizeMeanVariance(mu, cov, lambda, maxWeight) {
  const n = mu.length;
  let w = projectCappedSimplex(Array(n).fill(1 / n), maxWeight);

  const largestEigenvalue = Math.max(powerIterationLargestEigenvalue(cov), 1e-8);
  const step = 0.8 / (lambda * largestEigenvalue + 1e-12);

  for (let iter = 0; iter < 10000; iter++) {
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

function renderResults(prior, posterior, weights, riskFree) {
  const expectedReturn = dot(posterior, weights);
  const variance = dot(weights, matVec(state.covariance, weights));
  const volatility = Math.sqrt(Math.max(variance, 0));
  const sharpe = volatility > 0 ? (expectedReturn - riskFree) / volatility : NaN;

  $('metricReturn').textContent = formatPct(expectedReturn);
  $('metricVol').textContent = formatPct(volatility);
  $('metricSharpe').textContent = Number.isFinite(sharpe) ? sharpe.toFixed(2) : '—';

  const table = $('resultsTable');
  table.replaceChildren();

  state.assets.forEach((asset, i) => {
    const tr = document.createElement('tr');
    [
      asset,
      formatPct(prior[i]),
      formatPct(posterior[i]),
      formatPct(weights[i])
    ].forEach((value) => {
      const td = document.createElement('td');
      td.textContent = value;
      tr.append(td);
    });
    table.append(tr);
  });

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

  $('results').classList.remove('hidden');
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
      throw new Error('行列が特異です。価格系列またはViewを見直してください。');
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
  return `${(100 * x).toFixed(2)}%`;
}
