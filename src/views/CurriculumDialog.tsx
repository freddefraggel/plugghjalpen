import { useEffect, useRef } from 'react';
import type { Lgr22Stage } from '../lib/lgr22-parse';
import { CloseIcon } from '../icons';

interface Props {
  subject: string;
  stage: Lgr22Stage;
  gymnasium?: boolean;
  open: boolean;
  onClose: () => void;
}

/** Visar Skolverkets centrala innehåll i en bred dialog i stället för i den smala sidopanelen. */
export default function CurriculumDialog({ subject, stage, gymnasium, open, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="curriculum"
      aria-labelledby="cc-title"
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
    >
      <div className="curriculum-head">
        <div>
          <h2 id="cc-title">Centralt innehåll i {subject.toLowerCase()}</h2>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            {gymnasium
              ? `Gymnasiet, ${stage.years.toLowerCase()} · Skolverkets ämnesplan`
              : `Årskurs ${stage.years.replace('-', '–')} · Skolverkets kursplan (Lgr22)`}
          </p>
        </div>
        <button className="icon-btn" aria-label="Stäng" onClick={onClose}><CloseIcon /></button>
      </div>
      <div className="curriculum-body">
        {stage.areas.map((a) => (
          <section key={a.heading} className="curriculum-area">
            <h3>{a.heading}</h3>
            <ul>
              {a.items.map((i) => <li key={i}>{i}</li>)}
            </ul>
          </section>
        ))}
      </div>
    </dialog>
  );
}
