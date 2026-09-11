import { useState } from "react";
import { Button } from "../../components/common/Button";
import { ErrorMessage } from "../../components/common/ErrorMessage";
import { useAutoDismiss } from "../../hooks/useAutoDismiss";
export function Contact() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", message: "" });
  useAutoDismiss(sent, () => setSent(false));
  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setSent(false);
  };
  const submit = (event) => {
    event.preventDefault();
    setError("");
    if (!form.name.trim() || !form.email.trim() || !form.message.trim()) {
      setError("Please fill in your name, email, and message.");
      return;
    }
    // B9: there is no contact-messages backend yet, so open the visitor's
    // mail app addressed to the facility with the message pre-filled, and
    // confirm it on screen. This replaces the old no-op preventDefault().
    setSending(true);
    try {
      const subject = encodeURIComponent(
        `Court inquiry from ${form.name.trim()}`,
      );
      const body = encodeURIComponent(
        `Name: ${form.name.trim()}\nEmail: ${form.email.trim()}\n\n${form.message.trim()}`,
      );
      window.location.href = `mailto:hello@alicayardpickleball.ph?subject=${subject}&body=${body}`;
      setSent(true);
      setForm({ name: "", email: "", message: "" });
    } finally {
      setSending(false);
    }
  };
  return (
    <main className="page-wrap contact-page">
      <div className="page-intro compact">
        <span className="eyebrow">SAY HELLO</span>
        <h1>
          Let's talk
          <br />
          <em>pickleball.</em>
        </h1>
        <p>
          Need a hand with a booking or have a question about the courts? We are
          here.
        </p>
      </div>
      <div className="contact-grid">
        <div className="contact-details">
          <span className="section-index">COME FIND US</span>
          <strong>Alicayard Pickle Ball</strong>
          <p>
            18 Palm Avenue
            <br />
            Makati, Metro Manila
          </p>
          <span className="section-index">GET IN TOUCH</span>
          <p>
            hello@alicayardpickleball.ph
            <br />
            +63 917 555 0188
          </p>
        </div>
        <form className="form-card" onSubmit={submit}>
          <label>
            Your name
            <input
              placeholder="Mia Santos"
              value={form.name}
              onChange={(event) => update("name", event.target.value)}
              required
            />
          </label>
          <label>
            Email address
            <input
              type="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={(event) => update("email", event.target.value)}
              required
            />
          </label>
          <label>
            How can we help?
            <textarea
              rows="4"
              placeholder="Tell us what is on your mind..."
              value={form.message}
              onChange={(event) => update("message", event.target.value)}
              required
            />
          </label>
          {error && <ErrorMessage message={error} />}
          {sent && (
            <p className="success-message" role="status">
              Thanks! Your email app should have opened — we will get back to
              you shortly.
            </p>
          )}
          <Button type="submit" disabled={sending}>
            {sending ? "Sending..." : "Send message"}{" "}
            <span aria-hidden="true">-&gt;</span>
          </Button>
        </form>
      </div>
    </main>
  );
}
