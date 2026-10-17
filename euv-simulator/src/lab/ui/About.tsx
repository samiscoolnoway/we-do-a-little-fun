import { nav } from '../../nav';

/**
 * Why a computational-science lab sits next to the EUV machine. The connections are general engineering physics;
 * nothing here describes or quantifies real ASML equipment.
 */
export function About() {
  return (
    <div className="about" data-testid="lab-about">
      <div className="atl-card">
        <h3>What this lab is</h3>
        <p>
          The EUV machine and the wafer explorer show <em>what</em> a lithography system does. This lab shows <em>how engineers compute</em> the physics behind
          machines like it: conservation laws turned into numbers by a solver, checked against theory, and judged by how far they can be trusted.
        </p>
        <p>
          Its experiment is a classic of computational fluid dynamics: air flowing past a blunt heat shield, the heat that flow delivers to the surface, and how
          that heat soaks into the shield. Every number comes from a real calculation: a finite-volume solver for the compressible Euler equations running in a
          background thread, a boundary-layer heating correlation and an implicit heat-conduction solver.
        </p>
      </div>
      <div className="banner warn small" data-testid="lab-disclaimer">
        <strong>A separate experiment.</strong> The compressible-flow case is an educational aerothermodynamics problem (a heat shield in a supersonic or
        hypersonic stream). An EUV scanner does not operate like a high-speed vehicle, and nothing in this lab models, reproduces or quantifies ASML equipment
        or its performance.
      </div>
      <div className="atl-card">
        <h3>Where the same ideas meet semiconductor equipment</h3>
        <div className="about-grid">
          <div>
            <h4>Heat transfer</h4>
            <p>
              Any optical system that absorbs part of the light it handles warms up, and the heat must be conducted away. The heat-shield tab solves the same
              conduction equation, ρ c_p ∂T/∂t = k ∂²T/∂x², that engineers use for thermal management in general.
            </p>
          </div>
          <div>
            <h4>Temperature and precision</h4>
            <p>
              Materials expand when they warm: ΔL = α L ΔT. Ordinary steel grows about 12 millionths of its length per kelvin, so a 1 m steel part grows about
              12 µm for a 1 K rise. Where positions matter at the nanometre scale, temperature has to be controlled very tightly, which is why thermal modelling
              matters in precision machines.
            </p>
          </div>
          <div>
            <h4>Fluid flow and cooling</h4>
            <p>
              Flowing fluids carry heat away, and cooling systems are designed with the conservation laws of mass, momentum and energy. Those flows are slow and
              viscous; this lab&apos;s flow is fast, compressible and inviscid. The equations share their structure, not their regime.
            </p>
          </div>
          <div>
            <h4>Numerical methods and validation</h4>
            <p>
              Meshes, time steps, convergence, verification against exact solutions and grid studies are the daily tools of simulation-driven engineering. The
              Workbench and Experiments tabs show them on a problem small enough to run in a browser.
            </p>
          </div>
        </div>
      </div>
      <div className="atl-card">
        <h3>How to use the lab</h3>
        <ol>
          <li>
            Press <strong>Run</strong> (left panel): the solver iterates until the flow stops changing. Watch the residual fall in the <strong>Workbench</strong>.
          </li>
          <li>Click anywhere in the flow to read the computed values with the <strong>Probe</strong>.</li>
          <li>
            Open <strong>Surface heating</strong> and <strong>Heat shield</strong> to follow the heat from the gas into the shield.
          </li>
          <li>
            Try the <strong>Experiments</strong> (Mach number, thickness, conductivity, grid) and the predict-run-compare activities under <strong>Learn</strong>.
          </li>
        </ol>
        <p className="atl-hint">
          Model limits are stated where results are shown: the flow solver is inviscid (no boundary layer, no separation: the wake is qualitative), the gas is
          calorically perfect, the heating correlation is laminar with an uncertainty of order 10–20 %, and the heat shield does not ablate.
        </p>
        <div className="runbar-row">
          <button type="button" onClick={() => nav.go('machine')} data-testid="about-to-machine">
            Back to the EUV machine
          </button>
          <button type="button" onClick={() => nav.go('explorer')}>
            Wafer &amp; transistor explorer
          </button>
        </div>
      </div>
    </div>
  );
}
