import express, { NextFunction, Request, Response } from "express";
import * as dotenv from "dotenv";
dotenv.config();
import * as bodyParser from "body-parser";
import cors from "cors";
import { Queue, QueueEvents, Worker } from "bullmq";

///Set up express and CORS
const app = express();
const port = process.env.PORT;
const allowedOrigins: string[] = ["https://waifus.nemusona.com"];
const options: cors.CorsOptions = {
  origin: allowedOrigins,
};
app.use(cors(options));

/// Set up JSON Parser to handle requests
const jsonParser = bodyParser.json();

/// Set up default settings from .env
const defaultPayload = {
  prompt: process.env.DEFAULT_PROMPT,
  negative_prompt: process.env.DEFAULT_NEGATIVE_PROMPT,
  sampler_index: process.env.DEFAULT_SAMPLER,
  steps: process.env.DEFAULT_STEPS,
  cfg_scale: process.env.DEFAULT_CFG_SCALE,
  sd_model_checkpoint: process.env.DEFAULT_CHECKPOINT,
  denoising_strength: process.env.DEFAULT_DENOISE_STRENGTH,
};

/// Settings for queue
const queueLimit = process.env.QUEUE_LIMIT;
const queueDelay = process.env.DELAY;
const queueTimeout = process.env.TIMEOUT;

/// Set up queue
const queue = new Queue("nemu", {
  connection: {
    host: process.env.REDIS_URL,
    port: Number(process.env.REDIS_PORT),
    password: process.env.REDIS_PASS,
  },
});

const queueEvents = new QueueEvents("nemu", {
  connection: {
    host: process.env.REDIS_URL,
    port: Number(process.env.REDIS_PORT),
    password: process.env.REDIS_PASS,
  },
});

/// Get status of API
app.get("/", (req: Request, res: Response, next: NextFunction) => {
  return res.status(200).send("API is Alive");
});

/// Get queue from bull
app.get("/queue", async (req: Request, res: Response, next: NextFunction) => {
  const result = await queue.getJobCounts();
  const count =
    Number(result.active) + Number(result.delayed) + Number(result.waiting);
  return res.status(200).send(count.toString());
});

/// Send request to queue
app.post(
  "/generate",
  jsonParser,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      /// Get current queue
      const queueResult = await queue.getJobCounts();
      const count =
        Number(queueResult.active) +
        Number(queueResult.delayed) +
        Number(queueResult.waiting);

      /// Revert with 503 code if limit already reached
      if (count > Number(queueLimit)) {
        return res.status(503).send("Cannot process request");
      }

      /// Load in default payload
      const payload = { ...defaultPayload };

      /// Load in settings from request
      const positive = req.body.prompt;
      const negative_prompt = req.body.negative_prompt;
      const cfg_scale = req.body.cfg_scale;
      const denoising_strength = req.body.denoising_strength;
      if (positive) {
        payload.prompt += `, ${positive.toString()}`;
      }
      if (negative_prompt) {
        payload.negative_prompt += `, ${negative_prompt.toString()}`;
      }
      if (cfg_scale) {
        payload.cfg_scale = cfg_scale;
      }
      if (denoising_strength) {
        payload.denoising_strength = denoising_strength;
      }

      /// Add to queue with delay
      const job = await queue.add("prompt", payload, {
        removeOnComplete: true,
        removeOnFail: true,
        delay: Number(queueDelay),
      });

      /// Get base64 response from worker
      const base64 = await job.waitUntilFinished(
        queueEvents,
        Number(queueTimeout)
      );

      /// Return base64 to client
      return res.status(200).send(base64.toString());
    } catch (error) {
      return res.status(500).send("Server Error");
    }
  }
);

app.listen(port, () => {
  console.log(`Running on port ${port}`);
});
