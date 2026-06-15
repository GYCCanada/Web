import { HONEYPOT_FIELD } from '~/lib/honeypot';

export function HoneypotField() {
  return (
    <div aria-hidden="true" className="absolute h-0 w-0 overflow-hidden">
      <label htmlFor={HONEYPOT_FIELD}>Website</label>
      <input
        id={HONEYPOT_FIELD}
        name={HONEYPOT_FIELD}
        type="text"
        tabIndex={-1}
        autoComplete="off"
        defaultValue=""
      />
    </div>
  );
}
