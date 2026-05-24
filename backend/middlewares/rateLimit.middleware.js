import rateLimit from 'express-rate-limit';

/**
 * Limiteur de base pour toutes les requêtes API.
 * Prévient les abus généraux et les attaques par déni de service (DoS).
 */
export const apiLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 200, // Limite chaque IP à 200 requêtes par fenêtre de 15 minutes
	message: { success: false, message: "Trop de requêtes envoyées, veuillez réessayer plus tard." },
	standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
	legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

/**
 * Limiteur plus strict pour les routes d'authentification.
 * Protège contre les attaques par force brute sur les mots de passe et le spam d'emails.
 */
export const authLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 5, // Limite chaque IP à 5 requêtes par fenêtre de 15 minutes
	message: { success: false, message: "Trop de tentatives. Veuillez réessayer dans 15 minutes." },
	standardHeaders: true,
	legacyHeaders: false,
});