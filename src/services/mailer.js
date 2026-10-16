import nodemailer from 'nodemailer';

// Mail sent under NODE_ENV=test is recorded here instead of going out.
const outbox = [];

// Every email is sent from the SMTP mailbox (SMTP_USER), shown in inboxes as
// "Glass Gem Farm". Without SMTP_HOST (local development) it is logged instead.
const send = async (mail) => {
  const message = { from: { name: 'Glass Gem Farm', address: process.env.SMTP_USER }, ...mail };
  if (process.env.NODE_ENV === 'test') {
    outbox.push(message);
  } else if (!process.env.SMTP_HOST) {
    console.log(`[mail] to ${message.to}: ${message.subject}\n${message.text}`);
  } else {
    const port = Number(process.env.SMTP_PORT) || 587;
    await nodemailer
      .createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: port === 465, // 465 is TLS from the start; 587 upgrades via STARTTLS
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      })
      .sendMail(message);
  }
};

const sendVerificationEmail = (to, token) =>
  send({
    to,
    subject: 'Verify your email',
    text: `Welcome to Glass Gem Farm! Confirm your email address:\n\n${process.env.APP_URL}/verify-email?token=${token}\n\nThe link expires in 24 hours.`,
  });

const sendPasswordResetEmail = (to, token) =>
  send({
    to,
    subject: 'Reset your password',
    text: `Choose a new password:\n\n${process.env.APP_URL}/reset-password?token=${token}\n\nThe link expires in 1 hour. If you did not ask for this, ignore this email.`,
  });

export { outbox, sendVerificationEmail, sendPasswordResetEmail };
