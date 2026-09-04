import { Sequelize } from "sequelize";
import { config } from "../config.ts";

export const sequelize = new Sequelize(config.DATABASE_URL, {
  dialect: "postgres",
  logging: false,
  define: { underscored: true, timestamps: false },
  pool: { max: 10, min: 0, idle: 10_000 },
});
