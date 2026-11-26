import { useState } from 'react';
import type { AiSettings } from './lib/ai';
import type { Source } from './lib/extract';
import type { Quiz } from './lib/quiz';
import { loadSettings, saveResult, saveSettings, type QuizResult } from './lib/storage';
import { BookIcon } from './icons';
import StartView from './views/StartView';
import QuizView from './views/QuizView';
import ResultView from './views/ResultView';
import HistoryView from './views/HistoryView';
import SettingsView from './views/SettingsView';

type View =
  | { name: 'start' }
  | { name: 'quiz'; quiz: Quiz; sources: Source[] }
  | { name: 'result'; result: QuizResult; sources?: Source[] }
  | { name: 'history' }
  | { name: 'settings' };

export default function App() {
  const [view, setView] = useState<View>({ name: 'start' });
  const [settings, setSettings] = useState<AiSettings>(loadSettings);
  const [sources, setSources] = useState<Source[]>([]);

  const updateSettings = (s: AiSettings) => {
    setSettings(s);
    saveSettings(s);
  };

  if (view.name === 'quiz') {
    return (
      <QuizView
        quiz={view.quiz}
        sources={view.sources}
        settings={settings}
        onExit={() => setView({ name: 'start' })}
        onDone={(result) => {
          saveResult(result);
          setView({ name: 'result', result, sources: view.sources });
        }}
      />
    );
  }

  const nav = (name: 'start' | 'history' | 'settings', label: string) => (
    <button aria-current={view.name === name || (name === 'history' && view.name === 'result') ? 'page' : undefined} onClick={() => setView({ name } as View)}>
      {label}
    </button>
  );

  return (
    <>
      <header className="header">
        <button className="brand" onClick={() => setView({ name: 'start' })}>
          <span className="brand-mark" style={{ color: '#fff' }}><BookIcon /></span>
          Plugghjälpen
        </button>
        <nav className="nav" aria-label="Huvudmeny">
          {nav('start', 'Nytt quiz')}
          {nav('history', 'Mina resultat')}
          {nav('settings', 'Inställningar')}
        </nav>
      </header>
      {view.name === 'start' && (
        <StartView
          settings={settings}
          sources={sources}
          setSources={setSources}
          onQuiz={(quiz) => setView({ name: 'quiz', quiz, sources })}
          goSettings={() => setView({ name: 'settings' })}
        />
      )}
      {view.name === 'result' && (
        <ResultView
          result={view.result}
          onRetry={(quiz) => setView({ name: 'quiz', quiz, sources: view.sources ?? [] })}
          onNew={() => setView({ name: 'start' })}
        />
      )}
      {view.name === 'history' && <HistoryView onOpen={(result) => setView({ name: 'result', result })} />}
      {view.name === 'settings' && <SettingsView settings={settings} onChange={updateSettings} />}
    </>
  );
}
