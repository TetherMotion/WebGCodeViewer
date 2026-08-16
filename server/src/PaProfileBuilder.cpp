#include "tether/web/PaProfileBuilder.hpp"
#include "tether/motion_planner/profile_renurbs/PressureAdvanceReNURBSAdapter.hpp"
#include "tether/control/extrusion/ExtrusionPressureModels.hpp"
#include "tether/control/extrusion/LTIFrequencyDomainDeconvolver.hpp"
#include "tether/control/extrusion/OverlapAddLPVDeconvolver.hpp"
#include "tether/control/extrusion/CrossWlfRheology.hpp"
#include "tether/control/extrusion/PressureFlowLut.hpp"

#include <algorithm>
#include <cmath>

namespace tether::web {

using MotionPlanner::VelocityProfile;
using tether::motion::profile_renurbs::GenericReNURBSProfile;
using tether::motion::profile_renurbs::buildPressureAdvanceReNURBS;
using tether::motion::profile_renurbs::PressureAdvanceReNURBSConfig;
using tether::control::extrusion::FilamentGeometry;
using tether::control::extrusion::PowerLawPressureAdvance;
using tether::control::extrusion::CrossWlfPressureAdvance;
using tether::control::extrusion::CrossWlfParams;
using tether::control::extrusion::NozzleGeometry;
using tether::control::extrusion::PressureFlowLut;
using tether::control::extrusion::LTIFrequencyDomainDeconvolver;
using tether::control::extrusion::LTIDeconvolutionParams;
using tether::control::extrusion::OverlapAddLPVDeconvolver;
using tether::control::extrusion::OverlapAddLPVParams;

std::string paAlgorithmName(PaAlgorithm algo) {
    switch (algo) {
        case PaAlgorithm::Linear:    return "Linear";
        case PaAlgorithm::PowerLaw:  return "PowerLaw";
        case PaAlgorithm::CrossWlf:  return "CrossWLF";
        case PaAlgorithm::LtiDeconv: return "LTI-Deconv";
        case PaAlgorithm::LpvDeconv: return "LPV-Deconv";
        default: return "Unknown";
    }
}

namespace {

/// Extract extruder velocity and time arrays from the velocity profile.
/// Extruder velocity = path_velocity × extrusionRatio (interpolated per segment).
struct VelocityTimeSeries {
    std::vector<double> velocities;  ///< Extruder velocity [mm/s]
    std::vector<double> times;       ///< Time [s]
    std::vector<double> offsets;     ///< Position offset (raw E position) [mm]
    double sampleInterval;
};

/// Build a time series from the velocity profile, applying extrusion ratio.
/// The extrusion ratio is per-segment (from PlanningSegment E delta / length).
/// For segments with no extrusion (ratio=0), velocity is 0.
VelocityTimeSeries buildVelocityTimeSeries(
    const VelocityProfile<double>& vp,
    const std::vector<double>& extrusionRatios,
    double sampleInterval)
{
    VelocityTimeSeries ts;
    const auto& points = vp.points();
    if (points.empty()) return ts;

    ts.sampleInterval = sampleInterval;

    // Interpolate extrusion ratio at each profile point's arc length
    // by finding which segment it falls in.
    // Each segment i covers [segmentStart[i], segmentStart[i+1])
    // Build cumulative arc lengths for segments
    std::vector<double> segStart;
    double cumS = 0.0;
    for (size_t i = 0; i < extrusionRatios.size(); ++i) {
        segStart.push_back(cumS);
        // We don't have individual segment lengths here, so estimate from
        // the velocity profile points. For now, use uniform distribution.
        cumS += 1.0; // placeholder, will be replaced
    }

    // Actually, we should use the path's segment boundaries.
    // The velocity profile points have arcLength, and we need to map
    // each point to a segment. Since we don't have segment boundaries
    // directly, we'll use the velocity profile's total arc length
    // divided by the number of segments.
    double totalS = points.back().arcLength - points.front().arcLength;
    double segLen = extrusionRatios.size() > 0
        ? totalS / extrusionRatios.size() : totalS;

    ts.velocities.reserve(points.size());
    ts.times.reserve(points.size());

    for (const auto& pt : points) {
        // Find which segment this point falls in
        size_t segIdx = 0;
        if (segLen > 0) {
            segIdx = static_cast<size_t>((pt.arcLength - points.front().arcLength) / segLen);
            if (segIdx >= extrusionRatios.size()) segIdx = extrusionRatios.size() - 1;
        }

        double ratio = segIdx < extrusionRatios.size() ? extrusionRatios[segIdx] : 0.0;
        double extVel = pt.velocity * ratio;

        ts.velocities.push_back(extVel);
        ts.times.push_back(pt.time);
    }

    // Compute raw E position (integral of velocity)
    ts.offsets.resize(ts.velocities.size(), 0.0);
    for (size_t i = 1; i < ts.velocities.size(); ++i) {
        double dt = ts.times[i] - ts.times[i-1];
        ts.offsets[i] = ts.offsets[i-1] + ts.velocities[i] * dt;
    }

    return ts;
}

/// Compute PA offset series using Linear model: δe = PA · v_e
std::vector<double> computeLinearPaOffsets(
    const std::vector<double>& velocities,
    double paAmount, double smoothTime, double maxComp,
    double sampleInterval)
{
    // Linear PA is the Newtonian limit of PowerLaw with n=1, K_base = PA * A_f / A_f = PA
    // But we need to use the velocity directly: δe = PA · v_e
    // Use PowerLaw with flowIndex=1 and baseGain = PA (since Q = v_e * A_f, δe = K_base * Q^1 = K_base * v_e * A_f)
    // For δe = PA * v_e, we need K_base = PA / A_f
    FilamentGeometry fil;
    PowerLawPressureAdvance::Params pp;
    pp.baseGain = paAmount / fil.areaMm2();
    pp.flowIndex = 1.0;
    pp.smoothTime = smoothTime;
    pp.maxCompensation = maxComp;
    PowerLawPressureAdvance model(pp, fil);
    return model.offsetSeries(velocities, sampleInterval);
}

/// Compute PA offset series using PowerLaw model
std::vector<double> computePowerLawPaOffsets(
    const std::vector<double>& velocities,
    const PaConfig& config)
{
    FilamentGeometry fil;
    fil.filamentDiameterMm = config.filamentDiameter;
    PowerLawPressureAdvance::Params pp;
    pp.baseGain = config.powerLawBaseGain;
    pp.flowIndex = config.flowIndex;
    pp.smoothTime = config.smoothTime;
    pp.maxCompensation = config.maxCompensation;
    PowerLawPressureAdvance model(pp, fil);
    return model.offsetSeries(velocities, config.sampleInterval);
}

/// Compute PA offset series using CrossWLF model
std::vector<double> computeCrossWlfPaOffsets(
    const std::vector<double>& velocities,
    const PaConfig& config)
{
    // Build a default PressureFlowLut with standard CrossWLF parameters
    CrossWlfParams wlfParams;
    NozzleGeometry nozzle{0.4, 10.0}; // 0.4mm nozzle, 10mm length
    auto lut = std::make_shared<PressureFlowLut>();
    lut->build(wlfParams, nozzle, {1.0, 2.0, 4.0, 8.0}, {200.0, 220.0, 240.0});

    FilamentGeometry fil;
    fil.filamentDiameterMm = config.filamentDiameter;

    CrossWlfPressureAdvance::Params pp;
    pp.compressibilityOverArea = config.crossWlfCompressibility;
    pp.smoothTime = config.smoothTime;
    pp.maxCompensation = config.maxCompensation;
    pp.defaultTempC = config.meltTempC;

    CrossWlfPressureAdvance model(lut, pp, fil);

    // Use constant temperature for all samples
    std::vector<double> temps(velocities.size(), config.meltTempC);
    return model.offsetSeries(velocities, temps, config.sampleInterval);
}

/// Generate a simple low-pass impulse response for LTI deconvolution
std::vector<double> makeLowPassImpulseResponse(int taps, double cutoff) {
    std::vector<double> h(taps, 0.0);
    double sum = 0.0;
    for (int i = 0; i < taps; ++i) {
        double n = i - (taps - 1) / 2.0;
        if (std::abs(n) < 1e-10) {
            h[i] = 2.0 * cutoff;
        } else {
            h[i] = std::sin(2.0 * M_PI * cutoff * n) / (M_PI * n);
        }
        // Hamming window
        h[i] *= 0.54 - 0.46 * std::cos(2.0 * M_PI * i / (taps - 1));
        sum += h[i];
    }
    // Normalize
    for (auto& v : h) v /= sum;
    return h;
}

/// Compute PA offset series using LTI frequency-domain deconvolution
std::vector<double> computeLtiDeconvOffsets(
    const std::vector<double>& velocities,
    const PaConfig& config)
{
    if (velocities.empty()) return {};

    // The LTI deconvolver computes the required input x_req given a target
    // output y_tgt and an impulse response h. For PA, we use the velocity
    // profile as the target and a low-pass impulse response modeling the
    // extruder lag.
    LTIDeconvolutionParams params;
    params.lambda = config.ltiLambda;
    LTIFrequencyDomainDeconvolver deconv(params);

    // Model the extruder as a low-pass filter with PA time constant
    int taps = std::max(8, static_cast<int>(config.smoothTime / config.sampleInterval * 4));
    double cutoff = 1.0 / (2.0 * M_PI * config.smoothTime);
    auto h = makeLowPassImpulseResponse(taps, cutoff);

    // Target: the desired extruder position (integral of velocity)
    // But for PA, we want the compensated position, so we deconvolve
    // the raw position to get the required input (which includes PA).
    std::vector<double> targetPos(velocities.size(), 0.0);
    for (size_t i = 1; i < velocities.size(); ++i) {
        targetPos[i] = targetPos[i-1] + velocities[i] * config.sampleInterval;
    }

    auto xReq = deconv.deconvolve(targetPos, h);

    // The PA offset is the difference between required input and target
    std::vector<double> offsets(xReq.size(), 0.0);
    for (size_t i = 0; i < std::min(xReq.size(), targetPos.size()); ++i) {
        offsets[i] = xReq[i] - targetPos[i];
        // Clamp to maxCompensation
        if (offsets[i] > config.maxCompensation) offsets[i] = config.maxCompensation;
        if (offsets[i] < -config.maxCompensation) offsets[i] = -config.maxCompensation;
    }

    return offsets;
}

/// Compute PA offset series using LPV overlap-add deconvolution
std::vector<double> computeLpvDeconvOffsets(
    const std::vector<double>& velocities,
    const PaConfig& config)
{
    if (velocities.empty()) return {};

    OverlapAddLPVParams params;
    params.blockSize = config.lpvBlockSize;
    params.overlapRatio = config.lpvOverlapRatio;
    params.lambda = config.ltiLambda;
    OverlapAddLPVDeconvolver lpv(params);

    // Add operating points at different velocity levels
    // The impulse response varies with velocity (faster = less lag)
    for (double v = 10.0; v <= 200.0; v += 30.0) {
        double effectiveSmoothTime = config.smoothTime * (1.0 - 0.3 * v / 200.0);
        int taps = std::max(8, static_cast<int>(effectiveSmoothTime / config.sampleInterval * 4));
        double cutoff = 1.0 / (2.0 * M_PI * effectiveSmoothTime);
        auto h = makeLowPassImpulseResponse(taps, cutoff);
        lpv.addOperatingPoint(v, h);
    }

    // Target: desired extruder position
    std::vector<double> targetPos(velocities.size(), 0.0);
    for (size_t i = 1; i < velocities.size(); ++i) {
        targetPos[i] = targetPos[i-1] + velocities[i] * config.sampleInterval;
    }

    // Scheduling parameter: velocity itself
    std::vector<double> p(velocities.size(), 0.0);
    for (size_t i = 0; i < velocities.size(); ++i) {
        p[i] = std::abs(velocities[i]);
    }

    auto xReq = lpv.deconvolve(targetPos, p);

    // PA offset = required input - target
    std::vector<double> offsets(xReq.size(), 0.0);
    for (size_t i = 0; i < std::min(xReq.size(), targetPos.size()); ++i) {
        offsets[i] = xReq[i] - targetPos[i];
        if (offsets[i] > config.maxCompensation) offsets[i] = config.maxCompensation;
        if (offsets[i] < -config.maxCompensation) offsets[i] = -config.maxCompensation;
    }

    return offsets;
}

/// Fit PA offsets + velocities to a ReNURBS profile
PaProfileResult fitPaToReNurbs(
    const std::vector<double>& offsets,
    const std::vector<double>& velocities,
    double sampleInterval,
    double maxCompensation,
    PaAlgorithm algo)
{
    PaProfileResult result;
    result.algorithm = algo;
    result.algorithmName = paAlgorithmName(algo);

    if (offsets.empty()) return result;

    // Compute max values for normalization
    float maxOff = 0.0f, maxVel = 0.0f;
    for (size_t i = 0; i < offsets.size(); ++i) {
        maxOff = std::max(maxOff, static_cast<float>(std::abs(offsets[i])));
        maxVel = std::max(maxVel, static_cast<float>(std::abs(velocities[i])));
    }
    result.maxOffset = maxOff;
    result.maxVelocity = maxVel;

    // Build ReNURBS profile with 2 quantities: offset + velocity
    PressureAdvanceReNURBSConfig paConfig;
    paConfig.certify = false;  // skip certification for speed
    paConfig.degree = 3;       // lower degree for smaller curves
    paConfig.maxControlPointsPerSegment = 32;

    try {
        result.profile = buildPressureAdvanceReNURBS(
            offsets, velocities, sampleInterval, maxCompensation, paConfig);
    } catch (const std::exception&) {
        // Fallback: single-quantity (offset only)
        try {
            result.profile = buildPressureAdvanceReNURBS(
                offsets, sampleInterval, maxCompensation, paConfig);
        } catch (const std::exception&) {
            // If both fail, leave profile empty
        }
    }

    return result;
}

} // anonymous namespace

PaProfileResult computePaProfile(
    const VelocityProfile<double>& velocityProfile,
    const std::vector<double>& extrusionRatios,
    const PaConfig& config)
{
    auto ts = buildVelocityTimeSeries(velocityProfile, extrusionRatios, config.sampleInterval);
    if (ts.velocities.empty()) {
        PaProfileResult empty;
        empty.algorithm = config.algorithm;
        empty.algorithmName = paAlgorithmName(config.algorithm);
        return empty;
    }

    std::vector<double> offsets;
    switch (config.algorithm) {
        case PaAlgorithm::Linear:
            offsets = computeLinearPaOffsets(ts.velocities,
                config.pressureAdvance, config.smoothTime,
                config.maxCompensation, config.sampleInterval);
            break;
        case PaAlgorithm::PowerLaw:
            offsets = computePowerLawPaOffsets(ts.velocities, config);
            break;
        case PaAlgorithm::CrossWlf:
            offsets = computeCrossWlfPaOffsets(ts.velocities, config);
            break;
        case PaAlgorithm::LtiDeconv:
            offsets = computeLtiDeconvOffsets(ts.velocities, config);
            break;
        case PaAlgorithm::LpvDeconv:
            offsets = computeLpvDeconvOffsets(ts.velocities, config);
            break;
    }

    return fitPaToReNurbs(offsets, ts.velocities, config.sampleInterval,
                          config.maxCompensation, config.algorithm);
}

std::vector<PaProfileResult> computeAllPaProfiles(
    const VelocityProfile<double>& velocityProfile,
    const std::vector<double>& extrusionRatios,
    const PaConfig& config)
{
    std::vector<PaProfileResult> results;
    const PaAlgorithm allAlgos[] = {
        PaAlgorithm::Linear,
        PaAlgorithm::PowerLaw,
        PaAlgorithm::CrossWlf,
        PaAlgorithm::LtiDeconv,
        PaAlgorithm::LpvDeconv,
    };

    for (auto algo : allAlgos) {
        PaConfig cfg = config;
        cfg.algorithm = algo;
        results.push_back(computePaProfile(velocityProfile, extrusionRatios, cfg));
    }

    return results;
}

} // namespace tether::web
