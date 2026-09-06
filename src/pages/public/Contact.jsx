import { Button } from "../../components/common/Button";
export function Contact() {
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
          <strong>Rally Court Club</strong>
          <p>
            18 Palm Avenue
            <br />
            Makati, Metro Manila
          </p>
          <span className="section-index">GET IN TOUCH</span>
          <p>
            hello@rallycourt.ph
            <br />
            +63 917 555 0188
          </p>
        </div>
        <form
          className="form-card"
          onSubmit={(event) => event.preventDefault()}>
          <label>
            Your name
            <input placeholder="Mia Santos" />
          </label>
          <label>
            Email address
            <input type="email" placeholder="you@example.com" />
          </label>
          <label>
            How can we help?
            <textarea rows="4" placeholder="Tell us what is on your mind..." />
          </label>
          <Button type="submit">
            Send message <span aria-hidden="true">-&gt;</span>
          </Button>
        </form>
      </div>
    </main>
  );
}
