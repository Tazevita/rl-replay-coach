import { useState, type FormEvent } from "react";
import type { HttpSupportGateway } from "../../adapters/http/support-gateway";

export function SupportPage({ email, gateway }: { email: string; gateway: HttpSupportGateway }) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string>();

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setStatus("sending");
    setError(undefined);
    try {
      await gateway.send({ subject, message });
      setSubject("");
      setMessage("");
      setStatus("sent");
    } catch (reason) {
      setStatus("idle");
      setError(reason instanceof Error ? reason.message : "Could not send your message.");
    }
  };

  return <main className="app-shell support-page">
    <a className="back-link" href="/">Back to replay viewer</a>
    <section className="support-layout">
      <header className="support-intro">
        <p className="eyebrow">Replay Lab support</p>
        <h1>How can we help?</h1>
        <p>Tell us what happened and include any details that might help us understand the issue.</p>
        <div className="support-response-note">
          <span aria-hidden="true">01</span>
          <p><strong>Replies go to your account email.</strong> There is no need to include contact details in your message.</p>
        </div>
      </header>

      <form className="support-form" onSubmit={event => void submit(event)}>
        <div className="support-form-heading">
          <div>
            <p className="eyebrow">New message</p>
            <h2>Contact support</h2>
          </div>
          <span>All fields required</span>
        </div>

        <label>
          Account email
          <input type="email" value={email} readOnly aria-label="Account email" aria-describedby="support-email-note" />
          <small id="support-email-note">Connected to your signed-in account</small>
        </label>

        <label>
          Subject
          <input
            type="text"
            name="subject"
            aria-label="Subject"
            autoComplete="off"
            maxLength={120}
            required
            placeholder="A short summary of the issue"
            value={subject}
            disabled={status === "sending"}
            onChange={event => { setSubject(event.currentTarget.value); setStatus("idle"); }}
          />
        </label>

        <label>
          Message
          <textarea
            name="message"
            aria-label="Message"
            maxLength={5000}
            required
            placeholder="What happened? What did you expect instead?"
            value={message}
            disabled={status === "sending"}
            onChange={event => { setMessage(event.currentTarget.value); setStatus("idle"); }}
          />
          <small className="support-character-count">{message.length} / 5,000</small>
        </label>

        {status === "sent" && <p className="support-preview-status" role="status"><strong>Message sent.</strong> We will reply to {email}.</p>}
        {error && <p className="support-error" role="alert">{error}</p>}

        <div className="support-form-footer">
          <p>We will use your account email to reply.</p>
          <button type="submit" disabled={status === "sending"}>{status === "sending" ? "Sending..." : "Send message"}</button>
        </div>
      </form>
    </section>
  </main>;
}
