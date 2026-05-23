import { ApiError, ErrorTypes } from './ApiError.js';

/**
 * Valider un email
 */
export const validateEmail = (email) => {
  const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  return emailRegex.test(email);
};

/**
 * Valider un mot de passe
 * - Minimum 8 caractères
 * - Au moins 1 majuscule
 * - Au moins 1 minuscule
 * - Au moins 1 chiffre
 */
export const validatePassword = (password) => {
  if (password.length < 8) {
    throw ErrorTypes.ValidationError('Password must be at least 8 characters long');
  }
  
  if (!/[A-Z]/.test(password)) {
    throw ErrorTypes.ValidationError('Password must contain at least one uppercase letter');
  }
  
  if (!/[a-z]/.test(password)) {
    throw ErrorTypes.ValidationError('Password must contain at least one lowercase letter');
  }
  
  if (!/[0-9]/.test(password)) {
    throw ErrorTypes.ValidationError('Password must contain at least one number');
  }
  
  return true;
};

/**
 * Valider les données de signup
 */
export const validateSignupData = (data) => {
  const { email, password, fullName } = data;
  
  // Email requis
  if (!email || !email.trim()) {
    throw ErrorTypes.ValidationError('Email is required');
  }
  
  if (!validateEmail(email)) {
    throw ErrorTypes.ValidationError('Invalid email format');
  }
  
  // Password requis
  if (!password) {
    throw ErrorTypes.ValidationError('Password is required');
  }
  
  validatePassword(password);
  
  // FullName optionnel mais si présent, vérifier
  if (fullName && fullName.trim().length < 2) {
    throw ErrorTypes.ValidationError('Full name must be at least 2 characters');
  }
  
  return true;
};

/**
 * Valider les données de signin
 */
export const validateSigninData = (data) => {
  const { email, password } = data;
  
  if (!email || !email.trim()) {
    throw ErrorTypes.ValidationError('Email is required');
  }
  
  if (!validateEmail(email)) {
    throw ErrorTypes.ValidationError('Invalid email format');
  }
  
  if (!password) {
    throw ErrorTypes.ValidationError('Password is required');
  }
  
  return true;
};