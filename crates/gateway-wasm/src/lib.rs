use serde::{Deserialize, Serialize};
use snapdragon_gateway_core::GatewayExitReason;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct WasmBudget {
    pub initial_fuel: u64,
    pub epoch_deadline_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum WasmRunStatus {
    Completed,
    Trapped(String),
    BudgetExit(GatewayExitReason),
}

pub trait FuelMeter {
    fn consume(&mut self, fuel: u64) -> Result<(), GatewayExitReason>;
}

#[derive(Debug, Clone)]
pub struct SimpleFuelMeter {
    remaining: u64,
}

impl SimpleFuelMeter {
    pub fn new(budget: WasmBudget) -> Self {
        Self {
            remaining: budget.initial_fuel,
        }
    }

    pub fn remaining(&self) -> u64 {
        self.remaining
    }
}

impl FuelMeter for SimpleFuelMeter {
    fn consume(&mut self, fuel: u64) -> Result<(), GatewayExitReason> {
        if fuel > self.remaining {
            self.remaining = 0;
            return Err(GatewayExitReason::BudgetExceeded);
        }
        self.remaining -= fuel;
        Ok(())
    }
}

/// Placeholder host-independent runner contract. The `wasmtime-runtime` feature
/// will wire this budget shape to Wasmtime fuel/epoch interruption once the
/// daemon is ready to load real component workloads.
pub fn run_budgeted_steps(
    budget: WasmBudget,
    steps: impl IntoIterator<Item = u64>,
) -> WasmRunStatus {
    let mut meter = SimpleFuelMeter::new(budget);
    for step in steps {
        if let Err(reason) = meter.consume(step) {
            return WasmRunStatus::BudgetExit(reason);
        }
    }
    WasmRunStatus::Completed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fuel_exhaustion_becomes_budget_exit() {
        let status = run_budgeted_steps(
            WasmBudget {
                initial_fuel: 10,
                epoch_deadline_ms: None,
            },
            [4, 4, 4],
        );
        assert_eq!(
            status,
            WasmRunStatus::BudgetExit(GatewayExitReason::BudgetExceeded)
        );
    }
}
