import passport from "passport";
import { ExtractJwt, Strategy as JwtStrategy, type StrategyOptions } from "passport-jwt";
import { env } from "../config/env.js";

type JwtPayload = {
  sub?: string;
  email?: string;
};

const strategyOptions: StrategyOptions = {
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: env.JWT_PUBLIC_KEY ?? env.JWT_SECRET ?? "",
  algorithms: env.JWT_PUBLIC_KEY ? ["RS256"] : ["HS256"],
};

passport.use(
  new JwtStrategy(strategyOptions, async (payload: JwtPayload, done) => {
    if (!payload.sub) {
      return done(null, false);
    }

    return done(null, {
      id: payload.sub,
      email: payload.email ?? null,
    });
  }),
);

export const initializeAuth = () => passport.initialize();

export const requireAuth = passport.authenticate("jwt", { session: false });
