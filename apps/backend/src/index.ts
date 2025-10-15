import express from "express";
import cors from 'cors';
import { router } from "./routes";

const app = express();
const PORT = process.env.HTTP_PORT;

app.use(express.json());
app.use(cors());

app.use('/api/v1', router);

app.listen(3000, () => {
    console.log(`listening on port ${3000}`)
})