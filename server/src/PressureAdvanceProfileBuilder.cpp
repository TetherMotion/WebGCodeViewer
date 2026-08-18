#include "tether/web/PressureAdvanceProfileBuilder.hpp"
#include "tether/web/PressureAdvanceSerializer.hpp"
#include "tether/control/extrusion/CrossWlfRheology.hpp"
#include "tether/control/extrusion/PressureFlowLut.hpp"

#include <algorithm>
#include <cmath>
#include <format>
#include <iostream>
#include <vector>

namespace {

inline void PA_LOG(std::string_view stage) {
    std::cerr << "[PressureAdvanceProfileBuilder] " << stage << std::endl;
}

/// Generate a simple low-pass impulse response for LTI/LPV moment computation.
/// This models the extruder lag as a windowed sinc low-pass filter.
std::vector<double> makeLowPassImpulseResponse(int taps, double cutoff, double sampleRate) {
    std::vector<double> h(taps, 0.0);
    double sum = 0.0;
    for (int i = 0; i < taps; ++i) {
        double n = i - (taps - 1) / 2.0;
        if (std::abs(n) < 1e-10) {
            h[i] = 2.0 * cutoff;
        } else {
            h[i] = std::sin(2.0 * M_PI * cutoff * n / sampleRate) / (M_PI * n / sampleRate);
        }
        // Hamming window
        h[i] *= 0.54 - 0.46 * std::cos(2.0 * M_PI * i / (taps - 1));
        sum += h[i];
    }
    // Normalize
    for (auto& v : h) v /= sum;
    return h;
}

/// Compute moments M_k = ∫ h(τ) τ^k dτ for k = 0..K using trapezoidal integration.
std::vector<double> computeMoments(const std::vector<double>& h, double sampleRate, int K) {
    std::vector<double> moments(K + 1, 0.0);
    if (h.empty() || sampleRate <= 0.0) return moments;

    double dt = 1.0 / sampleRate;
    for (size_t i = 0; i < h.size(); ++i) {
        double tau = static_cast<double>(i) * dt;
        double hVal = h[i];
        double w = dt;
        if (i == 0 || i == h.size() - 1) w *= 0.5;
        for (int k = 0; k <= K; ++k) {
            moments[k] += hVal * std::pow(tau, k) * w;
        }
    }
    return moments;
}

} // anonymous namespace

namespace tether::web {

using tether::control::extrusion::CrossWlfParams;
using tether::control::extrusion::NozzleGeometry;
using tether::control::extrusion::PressureFlowLut;

std::string pressureAdvanceAlgorithmName(PressureAdvanceAlgorithm algo) {
    switch (algo) {
        case PressureAdvanceAlgorithm::Linear:    return "Linear";
        case PressureAdvanceAlgorithm::PowerLaw:  return "PowerLaw";
        case PressureAdvanceAlgorithm::CrossWlf:  return "CrossWLF";
        case PressureAdvanceAlgorithm::LtiDeconv: return "LTI-Deconv";
        case PressureAdvanceAlgorithm::LpvDeconv: return "LPV-Deconv";
        default: return "Unknown";
    }
}

std::vector<PressureAdvanceParamBlock> computeAllPressureAdvanceParams(
    const PressureAdvanceConfig& config)
{
    PA_LOG("computeAllPressureAdvanceParams: start (5 algorithms, no sampling)");
    std::vector<PressureAdvanceParamBlock> results;

    const PressureAdvanceAlgorithm allAlgos[] = {
        PressureAdvanceAlgorithm::Linear,
        PressureAdvanceAlgorithm::PowerLaw,
        PressureAdvanceAlgorithm::CrossWlf,
        PressureAdvanceAlgorithm::LtiDeconv,
        PressureAdvanceAlgorithm::LpvDeconv,
    };

    for (auto algo : allAlgos) {
        PressureAdvanceParamBlock block;
        block.algorithm = algo;
        block.algorithmName = pressureAdvanceAlgorithmName(algo);
        block.maxCompensation = static_cast<float>(config.maxCompensation);
        block.smoothTime = static_cast<float>(config.smoothTime);
        block.filamentDiameter = static_cast<float>(config.filamentDiameter);

        switch (algo) {
            case PressureAdvanceAlgorithm::Linear:
                block.pressureAdvance = static_cast<float>(config.pressureAdvance);
                block.maxOffset = static_cast<float>(
                    config.pressureAdvance * config.maxCompensation);
                block.maxVelocity = 100.0f;
                break;

            case PressureAdvanceAlgorithm::PowerLaw:
                block.powerLawBaseGain = static_cast<float>(config.powerLawBaseGain);
                block.flowIndex = static_cast<float>(config.flowIndex);
                block.maxOffset = static_cast<float>(config.maxCompensation);
                block.maxVelocity = 100.0f;
                break;

            case PressureAdvanceAlgorithm::CrossWlf: {
                block.crossWlfCompressibility = static_cast<float>(
                    config.crossWlfCompressibility);
                block.meltTempC = static_cast<float>(config.meltTempC);

                // Build the PressureFlowLUT with standard CrossWLF parameters
                CrossWlfParams wlfParams;
                NozzleGeometry nozzle{0.4, 10.0};
                auto lut = std::make_shared<PressureFlowLut>();
                lut->build(wlfParams, nozzle, {1.0, 2.0, 4.0, 8.0}, {200.0, 220.0, 240.0});

                // Package the LUT grid for the frontend
                const auto& flowAxis = lut->flowAxis();
                const auto& tempAxis = lut->tempAxis();
                const auto& values = lut->values();
                block.qGrid.assign(flowAxis.begin(), flowAxis.end());
                block.tempGrid.assign(tempAxis.begin(), tempAxis.end());
                block.pValues.assign(values.begin(), values.end());

                block.maxOffset = static_cast<float>(config.maxCompensation);
                block.maxVelocity = 100.0f;
                break;
            }

            case PressureAdvanceAlgorithm::LtiDeconv: {
                block.groupDelay = static_cast<float>(config.smoothTime * 0.5);

                // Build the impulse response and compute moments
                double sampleRate = 1.0 / config.sampleInterval;
                int taps = std::max(8, static_cast<int>(config.smoothTime * sampleRate * 4));
                double cutoff = 1.0 / (2.0 * M_PI * config.smoothTime);
                auto h = makeLowPassImpulseResponse(taps, cutoff, sampleRate);

                auto moments = computeMoments(h, sampleRate, 3);
                for (double m : moments) {
                    block.moments.push_back(static_cast<float>(m));
                }

                block.maxOffset = static_cast<float>(config.maxCompensation);
                block.maxVelocity = 100.0f;
                break;
            }

            case PressureAdvanceAlgorithm::LpvDeconv: {
                block.groupDelay = static_cast<float>(config.smoothTime * 0.5);

                // Build operating points at different velocity levels
                double sampleRate = 1.0 / config.sampleInterval;

                for (double v = 10.0; v <= 200.0; v += 30.0) {
                    double effectiveSmoothTime = config.smoothTime * (1.0 - 0.3 * v / 200.0);
                    int taps = std::max(8, static_cast<int>(effectiveSmoothTime * sampleRate * 4));
                    double cutoff = 1.0 / (2.0 * M_PI * effectiveSmoothTime);
                    auto h = makeLowPassImpulseResponse(taps, cutoff, sampleRate);

                    auto moments = computeMoments(h, sampleRate, 3);

                    block.opPointVelocities.push_back(static_cast<float>(v));
                    for (double m : moments) {
                        block.moments.push_back(static_cast<float>(m));
                    }
                }

                block.maxOffset = static_cast<float>(config.maxCompensation);
                block.maxVelocity = 200.0f;
                break;
            }
        }

        results.push_back(std::move(block));
        PA_LOG(std::format("computeAllPressureAdvanceParams: packaged {}",
            pressureAdvanceAlgorithmName(algo)));
    }

    PA_LOG("computeAllPressureAdvanceParams: done");
    return results;
}

} // namespace tether::web
