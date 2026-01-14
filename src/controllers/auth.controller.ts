import { Request, Response } from 'express';
import prisma from '../config/prisma'; // Ton instance Prisma
import bcrypt from 'bcrypt'; // Pour hacher les mots de passe
import jwt from 'jsonwebtoken';

export const register = async (req: Request, res: Response) => {
    try {
        const { email, password, fullName } = req.body;

        // 1. Vérifier si l'utilisateur existe déjà
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) return res.status(400).json({ message: "Cet email est déjà utilisé" });

        // 2. Hacher le mot de passe pour la sécurité
        const hashedPassword = await bcrypt.hash(password, 10);

        // 3. Créer l'utilisateur avec son quota par défaut (30Go)
        const newUser = await prisma.user.create({
            data: {
                email,
                fullName,
                passwordHash: hashedPassword,
                storageQuota: BigInt(32212254720) // 30 Go en octets
            }
        });

        res.status(201).json({ message: "Utilisateur créé avec succès", userId: newUser.id });
    } catch (error) {
        res.status(500).json({ error: "Erreur lors de l'inscription" });
    }
};

export const login = async (req: Request, res: Response) => {
    try {
        const { email, password } = req.body;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.passwordHash) return res.status(401).json({ message: "Identifiants invalides" });

        const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
        if (!isPasswordValid) return res.status(401).json({ message: "Identifiants invalides" });

        // Générer le JWT pour la session
        const token = jwt.sign(
            { userId: user.id, email: user.email },
            process.env.JWT_SECRET || 'secret_key',
            { expiresIn: '24h' }
        );

        res.json({ token, user: { id: user.id, email: user.email, fullName: user.fullName } });
    } catch (error) {
        res.status(500).json({ error: "Erreur lors de la connexion" });
    }
};