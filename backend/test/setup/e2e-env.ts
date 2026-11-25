// E2E tests enqueue email but must not start BullMQ workers or talk to SMTP.
process.env.JOBS_WORKERS_ENABLED = 'false';
