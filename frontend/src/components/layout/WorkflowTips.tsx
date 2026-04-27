import { motion } from "framer-motion";

// Workflow hints keep operators aligned with the required multisig sequence.
export function WorkflowTips() {
  const root = "Organization Setup";
  const branchA = [
    "Create wallet policy",
    "Bind chain for Ika pre-alpha execution"
  ];
  const branchB = [
    "Add intent template",
    "Approve + execute AddIntent",
    "Create proposal",
    "Approve to threshold",
    "Execute",
    "Cleanup"
  ];

  return (
    <motion.section 
       initial={{ opacity: 0, y: 15 }}
       animate={{ opacity: 1, y: 0 }}
       className="rounded-[2rem] border border-white/5 bg-white/[0.02] p-6 shadow-xl backdrop-blur-xl"
    >
      <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-brand-green">Operational Sequence</h3>
      <div className="rounded-2xl border border-white/10 bg-black/30 p-4 sm:p-5">
        <motion.div
          className="mx-auto flex w-full max-w-3xl flex-col items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
        >
          <motion.div
            whileHover={{ y: -2 }}
            className="rounded-xl border border-brand-green/40 bg-brand-green/10 px-4 py-2 text-sm font-semibold text-brand-white"
          >
            {root}
          </motion.div>

          <div className="h-5 w-px bg-brand-green/40" />

          <div className="grid w-full gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-brand-green">Wallet Branch</p>
              <ol className="space-y-2">
                {branchA.map((item, index) => (
                  <motion.li
                    key={item}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.12 + index * 0.06 }}
                    className="flex items-start gap-2 rounded-lg border border-white/10 bg-black/40 px-3 py-2"
                  >
                    <span className="mt-0.5 h-2 w-2 rounded-full bg-brand-green" />
                    <span className="text-sm text-brand-white">{item}</span>
                  </motion.li>
                ))}
              </ol>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-brand-green">Governance Branch</p>
              <ol className="space-y-2">
                {branchB.map((item, index) => (
                  <motion.li
                    key={item}
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.14 + index * 0.05 }}
                    className="flex items-start gap-2 rounded-lg border border-white/10 bg-black/40 px-3 py-2"
                  >
                    <span className="mt-0.5 h-2 w-2 rounded-full bg-brand-green" />
                    <span className="text-sm text-brand-white">{item}</span>
                  </motion.li>
                ))}
              </ol>
            </div>
          </div>
        </motion.div>
      </div>
    </motion.section>
  );
}
