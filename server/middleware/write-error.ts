import type { ErrorRequestHandler } from 'express';
import { WriteError } from '../writes.js';

export const handleWriteError: ErrorRequestHandler = (err: unknown, _req, res, next) => {
  if (err instanceof WriteError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  next(err);
};
