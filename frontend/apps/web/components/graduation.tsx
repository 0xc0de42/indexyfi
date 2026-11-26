import {LAUNCH, type Graduation} from '@/lib/launch';
import {compact} from '@/domain/model';

/** AUM progress toward the PancakeSwap graduation threshold. */
export function GraduationBar({g, aum, detail = true}: {g: Graduation; aum: number | null; detail?: boolean}) {
  return (
    <div className="graduation" data-testid="graduation" data-graduated={g.graduated}>
      <div className="graduation__track" role="progressbar" aria-label="Graduation progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(g.progressPct)}>
        <span style={{width: `${g.progressPct}%`}} />
      </div>
      {detail && (
        <small>
          {g.graduated
            ? `Graduated · PancakeSwap trading open (AUM ${compact(aum)})`
            : `${compact(aum)} of ${compact(LAUNCH.graduationUSD)} AUM · ${g.progressPct.toFixed(1)}% to PancakeSwap`}
        </small>
      )}
    </div>
  );
}
