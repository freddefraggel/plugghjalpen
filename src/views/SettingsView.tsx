import { useState } from 'react';
import { AiError, complete, listModels, pickAvailableModel, PROVIDERS, type AiSettings, type ProviderId } from '../lib/ai';
import { clearAll, DEFAULT_SETTINGS } from '../lib/storage';
import { CheckIcon } from '../icons';

interface Props {
  settings: AiSettings;
  onChange: (s: AiSettings) => void;
}

export default function SettingsView({ settings, onChange }: Props) {
  const [draft, setDraft] = useState<AiSettings>(settings);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error' | 'saved'; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [available, setAvailable] = useState<string[]>([]);
  const provider = PROVIDERS.find((p) => p.id === draft.provider)!;
  const extra = available
    .filter((id) => !provider.models.some((m) => m.id === id))
    .filter((id) => !/whisper|tts|guard|orpheus|embed|playai/i.test(id))
    .filter((id) => draft.provider !== 'openrouter' || id.endsWith(':free'))
    .sort();
  const modelOptions = [...provider.models, ...extra.map((id) => ({ id, label: id }))];
  const modelKnown = modelOptions.some((m) => m.id === draft.model);

  const pickProvider = (id: ProviderId) => {
    const p = PROVIDERS.find((x) => x.id === id)!;
    setDraft({ ...draft, provider: id, model: p.models[0].id });
    setAvailable([]);
    setStatus(null);
  };

  async function test() {
    setTesting(true);
    setStatus(null);
    try {
      let model = draft.model;
      let switched = false;
      try {
        const ids = await listModels(draft);
        setAvailable(ids);
        const pick = pickAvailableModel(draft.provider, draft.model, ids);
        if (pick && pick !== draft.model) {
          model = pick;
          switched = true;
        } else if (!pick && ids.length && !ids.includes(draft.model)) {
          throw new AiError(`Modellen ${draft.model} finns inte för din nyckel. Välj en annan modell i listan.`, 'model');
        }
      } catch (e) {
        // Modellistan är en hjälp; om den inte går att hämta testar vi ändå med vald modell.
        if (e instanceof AiError && e.code === 'model') throw e;
      }
      const next = { ...draft, model };
      await complete(next, 'Svara bara med ordet OK.', 'Test', 300);
      setDraft(next);
      if (switched) {
        onChange(next);
        setStatus({ kind: 'ok', text: `Anslutningen fungerar. Bytte till modellen ${model} och sparade.` });
      } else {
        setStatus({ kind: 'ok', text: 'Anslutningen fungerar' });
      }
    } catch (e) {
      setStatus({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <main className="main narrow">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1>Inställningar</h1>
        <p className="lead">Välj vilken AI som gör dina quiz. Nyckeln sparas bara i den här webbläsaren.</p>
      </div>

      <section className="card" aria-labelledby="ai-h">
        <h2 id="ai-h">AI-leverantör</h2>
        <div className="providers">
          {PROVIDERS.map((p) => (
            <button key={p.id} className="provider" aria-pressed={draft.provider === p.id} onClick={() => pickProvider(p.id)}>
              <strong>{p.name}</strong>
              <span>{p.blurb}</span>
            </button>
          ))}
        </div>

        <div className="field">
          <label htmlFor="modell">Modell</label>
          <select
            id="modell"
            className="input"
            value={modelKnown ? draft.model : '__custom'}
            onChange={(e) => setDraft({ ...draft, model: e.target.value === '__custom' ? '' : e.target.value })}
          >
            {modelOptions.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            <option value="__custom">Annan modell…</option>
          </select>
          {!modelKnown && (
            <input
              className="input"
              aria-label="Modellens namn"
              placeholder="Modellens id, t.ex. från leverantörens dokumentation"
              value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            />
          )}
        </div>

        <div className="field">
          <label htmlFor="nyckel">API-nyckel</label>
          <input
            id="nyckel"
            className="input"
            type="password"
            autoComplete="off"
            placeholder={provider.keyHint}
            value={draft.keys[draft.provider] ?? ''}
            onChange={(e) => setDraft({ ...draft, keys: { ...draft.keys, [draft.provider]: e.target.value.trim() } })}
          />
          <span className="small muted">
            Skapa en nyckel på <a href={provider.keyUrl} target="_blank" rel="noreferrer">{new URL(provider.keyUrl).hostname}</a>. Dela inte nyckeln med någon.
          </span>
        </div>

        <div className="inline" style={{ alignItems: 'center', gap: 12 }}>
          <button className="btn" onClick={() => { onChange(draft); setStatus({ kind: 'saved', text: 'Sparat' }); }}>Spara</button>
          <button className="btn secondary" onClick={test} disabled={testing || !draft.keys[draft.provider]}>
            {testing ? <><span className="spinner dark" /> Testar…</> : 'Testa anslutningen'}
          </button>
          {status && status.kind !== 'error' && <span className="ok-text" role="status"><CheckIcon size={18} /> {status.text}</span>}
        </div>
        {status?.kind === 'error' && <div className="error" role="alert">{status.text}</div>}
      </section>

      <section className="card" aria-labelledby="data-h">
        <h2 id="data-h">Mina data</h2>
        <p style={{ margin: 0, color: 'var(--ink-2)' }}>
          Dina quiz och resultat sparas bara på den här datorn. Ditt material skickas till AI-leverantören när quizet skapas och när fritextsvar rättas.
        </p>
        <div>
          <button
            className="btn danger"
            onClick={() => {
              clearAll();
              setDraft(DEFAULT_SETTINGS);
              onChange(DEFAULT_SETTINGS);
              setStatus({ kind: 'saved', text: 'Allt sparat är raderat' });
            }}
          >
            Radera allt sparat
          </button>
        </div>
      </section>
    </main>
  );
}
