import { logger } from './logger.js';

interface ScaleArgs {
    replicas: number;
}

export const policy = {
    validateScale: (args: ScaleArgs): { allowed: boolean; reason?: string } => {
        if (!Number.isFinite(args.replicas)) {
            const reason = 'Replicas must be a finite number';
            logger.policyViolation('Scale tool validation failed', { reason, args });
            return { allowed: false, reason };
        }

        if (!Number.isInteger(args.replicas)) {
            const reason = 'Replicas must be a whole number';
            logger.policyViolation('Scale tool validation failed', { reason, args });
            return { allowed: false, reason };
        }

        if (args.replicas < 0) {
            const reason = 'Replicas cannot be negative';
            logger.policyViolation('Scale tool validation failed', { reason, args });
            return { allowed: false, reason };
        }

        if (args.replicas === 0) {
            const reason = 'Cannot scale to zero replicas (would cause downtime)';
            logger.policyViolation('Scale tool blocked', { reason, args });
            return { allowed: false, reason };
        }

        // Guardrail: Max 10 replicas
        if (args.replicas > 10) {
            const reason = 'Policy Violation: Cannot scale above 10 replicas without manual approval';
            logger.policyViolation('Scale tool blocked', { reason, args });
            return { allowed: false, reason };
        }

        logger.info('Policy passed for scale_tool', args);
        return { allowed: true };
    },

    validateRollback: (): { allowed: boolean } => {
        // Always allowed in this demo, but logged
        logger.info('Policy passed for rollback_tool');
        return { allowed: true };
    },
};
